import { createWorker } from "tesseract.js";

// Cache worker để tái sử dụng
let cachedWorker: Tesseract.Worker | null = null;

async function getOrCreateWorker(): Promise<Tesseract.Worker> {
  if (cachedWorker) {
    return cachedWorker;
  }

  cachedWorker = await createWorker("eng");

  return cachedWorker;
}

async function performOCR(canvas: HTMLCanvasElement): Promise<string> {
  try {
    const worker = await getOrCreateWorker();

    // Sử dụng canvas trực tiếp thay vì base64
    const ret = await worker.recognize(canvas);
    console.log("OCR Result:", ret.data.text);
    return ret.data.text;
  } catch (error) {
    console.error("OCR failed:", error);
    throw error;
  }
}

async function callLLMAPI(text: string): Promise<string> {
  try {
    // Cấu hình API - có thể thay đổi tùy theo provider
    const API_URL =
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const API_KEY = "AIzaSyDihOaNaa5QQxIIlhd-4XVLvBmO2Pqw4bA"; // Sẽ cần lấy từ storage hoặc config

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are a translation assistant. Translate the given English text to Vietnamese. Only provide the Vietnamese translation, no explanations, no additional text, no formatting. If the input is already in Vietnamese or another language, translate it to Vietnamese. If the text is unclear or contains errors, provide the best possible Vietnamese translation.`,
          },
          {
            role: "user",
            content: `"${text}"`,
          },
        ],
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content;
    } else {
      throw new Error("No response from LLM");
    }
  } catch (error) {
    console.error("LLM API call failed:", error);
    throw error;
  }
}

// Lắng nghe message từ background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "performOCR") {
    // Tạo canvas từ base64 data
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        sendResponse({ success: false, error: "Cannot get canvas context" });
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      try {
        const text = await performOCR(canvas);
        sendResponse({ success: true, text: text });
      } catch (error) {
        sendResponse({ success: false, error: (error as Error).message });
      }
    };

    img.onerror = () => {
      sendResponse({ success: false, error: "Failed to load image" });
    };

    img.src = message.imageData;

    return true; // Giữ message channel mở cho async response
  }

  if (message.action === "performLLMCall") {
    (async () => {
      try {
        const translatedText = await callLLMAPI(message.text);
        sendResponse({ success: true, translatedText: translatedText });
      } catch (error) {
        sendResponse({ success: false, error: (error as Error).message });
      }
    })();

    return true; // Giữ message channel mở cho async response
  }
});

// Cleanup khi page unload
window.addEventListener("beforeunload", async () => {
  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
  }
});
