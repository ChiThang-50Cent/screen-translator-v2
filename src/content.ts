// Settings interface to match options page
interface Settings {
  apiKey: string;
  apiUrl: string;
  model: string;
  targetLanguage: string;
  ocrLanguage: string;
  ocrApiKey: string; // OCR.space API key
  ocrApiUrl: string; // OCR API URL
  temperature: number;
  systemPrompt: string;
}

const defaultSettings: Settings = {
  apiKey: '',
  apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  model: 'gemini-2.5-flash-lite',
  targetLanguage: 'vi',
  ocrLanguage: 'eng',
  ocrApiKey: '', // OCR.space API key
  ocrApiUrl: 'https://apipro2.ocr.space/parse/image', // OCR API URL
  temperature: 0.8,
  systemPrompt: ''
};

let currentSettings: Settings = { ...defaultSettings };

// Function to load settings from storage
async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaultSettings, function(items) {
      currentSettings = items as Settings;
      resolve(currentSettings);
    });
  });
}

// Load settings on initialization
loadSettings();

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    // Reload settings when they change
    
    // Update current settings with changed values
    if (changes.apiKey) currentSettings.apiKey = changes.apiKey.newValue;
    if (changes.apiUrl) currentSettings.apiUrl = changes.apiUrl.newValue;
    if (changes.model) currentSettings.model = changes.model.newValue;
    if (changes.targetLanguage) currentSettings.targetLanguage = changes.targetLanguage.newValue;
    if (changes.ocrLanguage) currentSettings.ocrLanguage = changes.ocrLanguage.newValue;
    if (changes.ocrApiKey) currentSettings.ocrApiKey = changes.ocrApiKey.newValue;
    if (changes.ocrApiUrl) currentSettings.ocrApiUrl = changes.ocrApiUrl.newValue;
    if (changes.temperature) currentSettings.temperature = changes.temperature.newValue;
    if (changes.systemPrompt) currentSettings.systemPrompt = changes.systemPrompt.newValue;
  }
});

async function performOCR(canvas: HTMLCanvasElement): Promise<string> {
  try {
    // Check if OCR API key is configured
    if (!currentSettings.ocrApiKey.trim()) {
      throw new Error('OCR API key not configured. Please open the extension options and set your OCR.space API key.');
    }

    // Check if OCR API URL is configured
    if (!currentSettings.ocrApiUrl.trim()) {
      throw new Error('OCR API URL not configured. Please open the extension options and set your OCR API URL.');
    }

    // Convert canvas to base64 for OCR.space API
    const base64Data = canvas.toDataURL('image/png');

    const formData = new FormData();
    formData.append('base64Image', base64Data);
    formData.append('language', currentSettings.ocrLanguage);
    formData.append('OCREngine', '2'); // Engine 2 is better for special characters and complex backgrounds
    formData.append('scale', 'true'); // Improve OCR for low-resolution images
    formData.append('isTable', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('apikey', currentSettings.ocrApiKey);

    const response = await fetch(currentSettings.ocrApiUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`OCR API request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    if (result.IsErroredOnProcessing) {
      throw new Error(`OCR processing error: ${result.ErrorMessage}`);
    }

    if (result.ParsedResults && result.ParsedResults.length > 0) {
      const parsedText = result.ParsedResults[0].ParsedText;
      return parsedText;
    } else {
      throw new Error('No text found in the image');
    }
  } catch (error) {
    console.error("OCR failed:", error);
    throw error;
  }
}

async function callLLMAPI(text: string): Promise<string> {
  const maxRetries = 3; // Default retry count
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check if API key is configured
      if (!currentSettings.apiKey.trim()) {
        throw new Error('API key not configured. Please open the extension options and set your Gemini API key.');
      }

      // Validate API URL
      if (!currentSettings.apiUrl.trim()) {
        throw new Error('API URL not configured. Please check your extension settings.');
      }

      // Validate model
      if (!currentSettings.model.trim()) {
        throw new Error('Model not configured. Please check your extension settings.');
      }

      // Get target language name for better translation prompts
      const languageNames: { [key: string]: string } = {
        'vi': 'Vietnamese',
        'en': 'English',
        'zh': 'Chinese',
        'ja': 'Japanese',
        'ko': 'Korean',
        'fr': 'French',
        'de': 'German',
        'es': 'Spanish'
      };

      const targetLanguageName = languageNames[currentSettings.targetLanguage] || 'Vietnamese';

      // Use custom system prompt if provided, otherwise use default
      const systemPrompt = currentSettings.systemPrompt.trim() || 
        `You are a professional manga translation engine. Your sole function is to translate the user's input into ${targetLanguageName} by following these strict rules.

**MANDATORY RULES:**
1.  **Output is Translation Only:** Your entire response must be ONLY the translated text in ${targetLanguageName}.
2.  **No Extra Content:** Do not include greetings, explanations, notes, apologies, or the original text.
3.  **No Formatting:** Do not use any Markdown (like '**' or '*'), HTML, or other formatting. Return only plain text.`;

      const response = await fetch(currentSettings.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentSettings.apiKey}`,
        },
        body: JSON.stringify({
          model: currentSettings.model,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: `"${text}"`,
            },
          ],
          temperature: currentSettings.temperature,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.choices && data.choices.length > 0) {
        const translatedText = data.choices[0].message.content;
        return translatedText;
      } else {
        throw new Error("No response from LLM");
      }
    } catch (error) {
      lastError = error as Error;
      console.error(`LLM API attempt ${attempt} failed:`, error);

      // Don't retry if it's an authentication or configuration error
      if (error instanceof Error && 
          (error.message.includes('API key') || 
           error.message.includes('401') || 
           error.message.includes('403'))) {
        throw error;
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

// Lắng nghe message từ background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle settings update
  if (message.action === "settingsUpdated") {
    currentSettings = message.settings as Settings;    
    sendResponse({ success: true });
    return true;
  }

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

// No cleanup needed for OCR.space API
