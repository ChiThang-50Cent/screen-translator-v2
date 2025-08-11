// Options page script
document.addEventListener('DOMContentLoaded', function() {
    const elements = {
        apiKey: document.getElementById('apiKey'),
        ocrApiKey: document.getElementById('ocrApiKey'),
        ocrApiUrl: document.getElementById('ocrApiUrl'),
        apiUrl: document.getElementById('apiUrl'),
        model: document.getElementById('model'),
        targetLanguage: document.getElementById('targetLanguage'),
        ocrLanguage: document.getElementById('ocrLanguage'),
        temperature: document.getElementById('temperature'),
        temperatureValue: document.getElementById('temperatureValue'),
        systemPrompt: document.getElementById('systemPrompt'),
        saveBtn: document.getElementById('saveBtn'),
        resetBtn: document.getElementById('resetBtn'),
        testBtn: document.getElementById('testBtn'),
        status: document.getElementById('status')
    };

    // Default settings
    const defaultSettings = {
        apiKey: '',
        ocrApiKey: '',
        ocrApiUrl: 'https://apipro2.ocr.space/parse/image',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        model: 'gemini-2.5-flash-lite',
        targetLanguage: 'vi',
        ocrLanguage: 'eng',
        temperature: 0.8,
        systemPrompt: ''
    };

    // Load settings from storage
    function loadSettings() {
        chrome.storage.sync.get(defaultSettings, function(items) {
            elements.apiKey.value = items.apiKey || '';
            elements.ocrApiKey.value = items.ocrApiKey || '';
            elements.ocrApiUrl.value = items.ocrApiUrl;
            elements.apiUrl.value = items.apiUrl;
            elements.model.value = items.model;
            elements.targetLanguage.value = items.targetLanguage;
            elements.ocrLanguage.value = items.ocrLanguage;
            elements.temperature.value = items.temperature;
            elements.temperatureValue.textContent = items.temperature;
            elements.systemPrompt.value = items.systemPrompt || '';
        });
    }

    // Save settings to storage
    function saveSettings() {
        // Basic validation
        const apiKey = elements.apiKey.value.trim();
        const ocrApiKey = elements.ocrApiKey.value.trim();
        const ocrApiUrl = elements.ocrApiUrl.value.trim();
        const apiUrl = elements.apiUrl.value.trim();
        const model = elements.model.value.trim();
        const targetLanguage = elements.targetLanguage.value.trim().toLowerCase();
        const ocrLanguage = elements.ocrLanguage.value.trim().toLowerCase();
        const temperature = parseFloat(elements.temperature.value);
        const systemPrompt = elements.systemPrompt.value.trim();

        if (!apiKey) {
            showStatus('❌ Gemini API Key is required', 'error');
            elements.apiKey.focus();
            return;
        }

        if (!ocrApiKey) {
            showStatus('❌ OCR.space API Key is required', 'error');
            elements.ocrApiKey.focus();
            return;
        }

        if (!ocrApiUrl) {
            showStatus('❌ OCR API URL is required', 'error');
            elements.ocrApiUrl.focus();
            return;
        }

        // Validate OCR URL format
        try {
            new URL(ocrApiUrl);
        } catch {
            showStatus('❌ Invalid OCR API URL format', 'error');
            elements.ocrApiUrl.focus();
            return;
        }

        if (!apiUrl) {
            showStatus('❌ API URL is required', 'error');
            elements.apiUrl.focus();
            return;
        }

        // Validate URL format
        try {
            new URL(apiUrl);
        } catch {
            showStatus('❌ Invalid API URL format', 'error');
            elements.apiUrl.focus();
            return;
        }

        if (!model) {
            showStatus('❌ Model is required', 'error');
            elements.model.focus();
            return;
        }

        if (!targetLanguage) {
            showStatus('❌ Target Language is required', 'error');
            elements.targetLanguage.focus();
            return;
        }

        // Validate target language code
        const validTargetLanguages = ['vi', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'];
        if (!validTargetLanguages.includes(targetLanguage)) {
            showStatus('❌ Invalid target language code. Use: ' + validTargetLanguages.join(', '), 'error');
            elements.targetLanguage.focus();
            return;
        }

        if (!ocrLanguage) {
            showStatus('❌ OCR Language is required', 'error');
            elements.ocrLanguage.focus();
            return;
        }

        // Validate OCR language code for OCR.space API
        const validOcrLanguages = ['ara', 'bul', 'chs', 'cht', 'hrv', 'cze', 'dan', 'dut', 'eng', 'fin', 'fre', 'ger', 'gre', 'hun', 'kor', 'ita', 'jpn', 'pol', 'por', 'rus', 'slv', 'spa', 'swe', 'tha', 'tur', 'ukr', 'vnm', 'auto'];
        if (!validOcrLanguages.includes(ocrLanguage)) {
            showStatus('❌ Invalid OCR language code. Use: ' + validOcrLanguages.slice(0, 10).join(', ') + '...', 'error');
            elements.ocrLanguage.focus();
            return;
        }

        if (isNaN(temperature) || temperature < 0 || temperature > 1) {
            showStatus('❌ Temperature must be a number between 0 and 1', 'error');
            elements.temperature.focus();
            return;
        }

        const settings = {
            apiKey: apiKey,
            ocrApiKey: ocrApiKey,
            ocrApiUrl: ocrApiUrl,
            apiUrl: apiUrl,
            model: model,
            targetLanguage: targetLanguage,
            ocrLanguage: ocrLanguage,
            temperature: temperature,
            systemPrompt: systemPrompt
        };

        chrome.storage.sync.set(settings, function() {
            if (chrome.runtime.lastError) {
                showStatus('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
            } else {
                showStatus('✅ Settings saved successfully!', 'success');
                
                // Notify content scripts about settings change
                chrome.tabs.query({}, function(tabs) {
                    tabs.forEach(tab => {
                        if (tab.id) {
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'settingsUpdated',
                                settings: settings
                            }).catch(() => {
                                // Ignore errors for tabs that don't have content script
                            });
                        }
                    });
                });
            }
        });
    }

    // Reset to default settings
    function resetSettings() {
        if (confirm('Are you sure you want to reset all settings to defaults?')) {
            chrome.storage.sync.clear(function() {
                loadSettings();
                showStatus('Settings reset to defaults', 'info');
            });
        }
    }

    // Test API connection
    async function testApiConnection() {
        const apiKey = elements.apiKey.value.trim();
        const apiUrl = elements.apiUrl.value.trim();
        const model = elements.model.value;

        if (!apiKey) {
            showStatus('Please enter an API key first', 'error');
            return;
        }

        showStatus('Testing API connection...', 'info');
        elements.testBtn.disabled = true;

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: 'Hello' }],
                    max_tokens: 10
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.choices && data.choices.length > 0) {
                    showStatus('✅ API connection successful!', 'success');
                } else {
                    showStatus('⚠️ API responded but format unexpected', 'error');
                }
            } else {
                const errorText = await response.text();
                showStatus(`❌ API error: ${response.status} - ${errorText}`, 'error');
            }
        } catch (error) {
            showStatus(`❌ Connection failed: ${error.message}`, 'error');
        } finally {
            elements.testBtn.disabled = false;
        }
    }

    // Show status message
    function showStatus(message, type) {
        elements.status.textContent = message;
        elements.status.className = `status ${type}`;
        
        if (type === 'success') {
            setTimeout(() => {
                elements.status.textContent = '';
                elements.status.className = 'status';
            }, 3000);
        }
    }

    // Update temperature display
    elements.temperature.addEventListener('input', function() {
        elements.temperatureValue.textContent = this.value;
    });

    // Event listeners
    elements.saveBtn.addEventListener('click', saveSettings);
    elements.resetBtn.addEventListener('click', resetSettings);
    elements.testBtn.addEventListener('click', testApiConnection);

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's':
                    e.preventDefault();
                    saveSettings();
                    break;
                case 'r':
                    e.preventDefault();
                    resetSettings();
                    break;
                case 't':
                    e.preventDefault();
                    testApiConnection();
                    break;
            }
        }
    });

    // Load settings on page load
    loadSettings();
});
