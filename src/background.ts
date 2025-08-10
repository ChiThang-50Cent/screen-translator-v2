chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectTranslatorScript,
    });
  }
});

// Add message listener for screen capture
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "captureVisibleTab") {
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
      sendResponse({ success: false, error: "Window ID not available" });
      return;
    }

    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message,
        });
        return;
      }

      // Just return the full screenshot, cropping will be done in content script
      sendResponse({ success: true, fullScreenshot: dataUrl });
    });
    return true; // Keep message channel open for async response
  }
  
  // Handle OCR request from injected script
  if (message.action === "performOCRInBackground") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: "Tab ID not available" });
      return;
    }

    // Send OCR request to content script
    chrome.tabs.sendMessage(tabId, {
      action: "performOCR",
      imageData: message.imageData
    }, (ocrResponse: { success: boolean; text?: string; error?: string }) => {
      if (chrome.runtime.lastError) {
        sendResponse({ 
          success: false, 
          error: 'Failed to communicate with content script: ' + chrome.runtime.lastError.message 
        });
        return;
      }
      
      // Forward the OCR response back to the injected script
      sendResponse(ocrResponse);
    });
    
    return true; // Keep message channel open for async response
  }
});

function injectTranslatorScript() {
  // Define all functions in the content script scope
  function toggleTranslatorButton() {
    const existingButton = document.getElementById("screen-translator-btn");

    if (existingButton) {
      existingButton.remove();
    } else {
      const button = document.createElement("button");
      button.id = "screen-translator-btn";
      button.textContent = "Capture";
      button.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        padding: 10px 15px;
        background: #646cff;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-family: system-ui;
      `;

      button.addEventListener("click", startCapture);

      document.body.appendChild(button);
    }
  }

  function startCapture(): void {
    // Create overlay
    const overlay = document.createElement("div");
    overlay.id = "capture-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(128, 128, 128, 0.5);
      z-index: 10001;
      cursor: crosshair;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui;
      color: white;
      font-size: 24px;
      user-select: none;
    `;
    overlay.textContent = "Select area to capture";

    const selectionBox = document.createElement("div");
    selectionBox.id = "selection-box";
    selectionBox.style.cssText = `
      position: fixed;
      border: 2px solid #ff0000;
      background: none;
      display: none;
      pointer-events: none;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8), 
                  0 0 0 9999px rgba(128, 128, 128, 0.5);
      z-index: 10003;
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(selectionBox);

    let isDrawing = false;
    let startX = 0;
    let startY = 0;

    overlay.addEventListener("mousedown", (e: MouseEvent) => {
      isDrawing = true;
      startX = e.clientX;
      startY = e.clientY;

      selectionBox.style.left = startX + "px";
      selectionBox.style.top = startY + "px";
      selectionBox.style.width = "0px";
      selectionBox.style.height = "0px";
      selectionBox.style.display = "block";
      overlay.textContent = "";
      overlay.style.background = "none";
    });

    overlay.addEventListener("mousemove", (e: MouseEvent) => {
      if (!isDrawing) return;

      const currentX = e.clientX;
      const currentY = e.clientY;

      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);

      selectionBox.style.left = left + "px";
      selectionBox.style.top = top + "px";
      selectionBox.style.width = width + "px";
      selectionBox.style.height = height + "px";
    });

    overlay.addEventListener("mouseup", async (e: MouseEvent) => {
      if (!isDrawing) return;

      isDrawing = false;
      const endX = e.clientX;
      const endY = e.clientY;

      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);

      if (width > 10 && height > 10) {
        await captureArea(
          Math.min(startX, endX),
          Math.min(startY, endY),
          width,
          height
        );
      }

      overlay.remove();
      selectionBox.remove();
    });

    // Close overlay on Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        overlay.remove();
        selectionBox.remove();
        document.removeEventListener("keydown", handleKeyDown);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
  }

  // Define response types
  interface CaptureResponse {
    success: boolean;
    fullScreenshot?: string;
    error?: string;
  }

  async function captureArea(
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> {
    try {
      // Send message to background script to capture the visible tab
      const response = await new Promise<CaptureResponse>((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "captureVisibleTab",
            coordinates: { x, y, width, height },
          },
          resolve
        );
      });

      if (response && response.success && response.fullScreenshot) {
        const croppedCanvas = await cropImage(
          response.fullScreenshot,
          x,
          y,
          width,
          height
        );

        // Convert canvas to base64 for sending to content script
        const croppedBase64 = croppedCanvas.toDataURL('image/png');
        
        // Send OCR request through background script (as proxy)
        chrome.runtime.sendMessage({
          action: "performOCRInBackground",
          imageData: croppedBase64
        }, (ocrResponse: { success: boolean; text?: string; error?: string }) => {
          if (chrome.runtime.lastError) {
            console.error('Background communication failed:', chrome.runtime.lastError.message);
            alert('Failed to communicate with background script');
            return;
          }
          
          if (ocrResponse && ocrResponse.success) {
            console.log('OCR Text:', ocrResponse.text);
            // Hiển thị kết quả hoặc xử lý tiếp
            alert('OCR Result: ' + ocrResponse.text);
          } else {
            console.error('OCR failed:', ocrResponse?.error);
            alert('OCR failed: ' + (ocrResponse?.error || 'Unknown error'));
          }
        });
      } else {
        throw new Error("Failed to capture screen");
      }
    } catch (error) {
      console.error("Capture failed:", error);
      alert("Capture failed: " + (error as Error).message);
    }
  }

  function cropImage(
    fullScreenshotBase64: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }

        canvas.width = width;
        canvas.height = height;

        // Draw the cropped portion
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

        // const croppedImage = canvas.toDataURL('image/png');
        resolve(canvas);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = fullScreenshotBase64;
    });
  }

  // Execute the toggle function
  toggleTranslatorButton();
}
