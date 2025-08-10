import { createWorker } from 'tesseract.js';

// Cache worker để tái sử dụng
let cachedWorker: Tesseract.Worker | null = null;

async function getOrCreateWorker(): Promise<Tesseract.Worker> {
  if (cachedWorker) {
    return cachedWorker;
  }

  cachedWorker = await createWorker('eng');

  return cachedWorker;
}

async function performOCR(canvas: HTMLCanvasElement): Promise<string> {
  try {
    const worker = await getOrCreateWorker();
    
    // Sử dụng canvas trực tiếp thay vì base64
    const ret = await worker.recognize(canvas);
    console.log('OCR Result:', ret.data.text);
    return ret.data.text;
  } catch (error) {
    console.error('OCR failed:', error);
    throw error;
  }
}

// Lắng nghe message từ background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "performOCR") {
    // Tạo canvas từ base64 data
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        sendResponse({ success: false, error: 'Cannot get canvas context' });
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
      sendResponse({ success: false, error: 'Failed to load image' });
    };
    
    img.src = message.imageData;
    
    return true; // Giữ message channel mở cho async response
  }
});

// Cleanup khi page unload
window.addEventListener('beforeunload', async () => {
  if (cachedWorker) {
    await cachedWorker.terminate();
    cachedWorker = null;
  }
});
