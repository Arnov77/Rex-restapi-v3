// Real-time Clock
setInterval(() => {
    const now = new Date();
    document.getElementById('time').innerText = now.toLocaleTimeString();
}, 1000);

fetch('data/apis.json')
    .then(response => response.json())
    .then(data => {
        const main = document.querySelector('main');
        let content = '';

        for (const [category, apis] of Object.entries(data)) {
            content += `
                <section>
                    <h2>${category}</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>No</th>
                                <th>Name</th>
                                <th>Method</th>
                                <th>Description</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${apis
                                .map(
                                    (api, index) => `
                                    <tr>
                                        <td>${index + 1}</td>
                                        <td>${api.name}</td>
                                        <td><span class="badge method-${api.method.toLowerCase()}">${api.method}</span></td>
                                        <td>${api.description || '-'}</td>
                                        <td>
                                            <button class="try-btn" onclick="openApiTest(${JSON.stringify(api).replace(/"/g, '&quot;')})">
                                                Test
                                            </button>
                                        </td>
                                    </tr>`
                                )
                                .join('')}
                        </tbody>
                    </table>
                </section>
            `;
        }

        main.innerHTML = content;
    })
    .catch(error => console.error('Error loading API list:', error));

function openApiTest(api) {
    const modal = document.getElementById('testModal');
    if (!modal) {
        createTestModal();
    }
    
    const testModal = document.getElementById('testModal');
    const formContainer = document.getElementById('formContainer');
    const responseContainer = document.getElementById('responseContainer');
    
    formContainer.innerHTML = '';
    responseContainer.innerHTML = '';
    
    // Build form
    let form = `
        <h3>Test: ${api.name}</h3>
        <div style="background-color: #1a1a1a; padding: 12px; border-radius: 5px; margin-bottom: 15px; border-left: 4px solid #ff6f61;">
            <p style="margin: 5px 0; color: #999; font-size: 0.9rem;">Endpoint Information</p>
            <code style="background-color: #2a2a2a; padding: 8px; border-radius: 3px; display: block; margin: 8px 0; color: #00ff00; font-size: 1rem;">${api.method} ${api.action}</code>
            ${api.description ? `<p style="margin: 5px 0; color: #ccc; font-size: 0.9rem;">${api.description}</p>` : ''}
        </div>
    `;
    
    if (api.method === 'POST' && api.params) {
        form += '<div class="form-group">';
        api.params.forEach(param => {
            // Special handling for Brat preset parameter
            if (param.name === 'preset' && api.name.toLowerCase().includes('brat')) {
                form += `
                    <label>${param.name}</label>
                    <select id="param-${param.name}" class="form-input" onchange="toggleBratColorOptions()">
                        <option value="bratdeluxe" selected>bratdeluxe (default)</option>
                        <option value="brat">brat</option>
                        <option value="custom">custom</option>
                    </select>
                `;
            } else if (param.name === 'bgColor' && api.name.toLowerCase().includes('brat')) {
                form += `
                    <div id="bgColor-field" style="display: none;">
                        <label>${param.name}</label>
                        <input 
                            type="text" 
                            id="param-${param.name}" 
                            placeholder="e.g., #FF5733 or red"
                            class="form-input"
                        >
                    </div>
                `;
            } else if (param.name === 'textColor' && api.name.toLowerCase().includes('brat')) {
                form += `
                    <div id="textColor-field" style="display: none;">
                        <label>${param.name}</label>
                        <input 
                            type="text" 
                            id="param-${param.name}" 
                            placeholder="e.g., #FFFFFF or white"
                            class="form-input"
                        >
                    </div>
                `;
            } else {
                form += `
                    <label>${param.name}</label>
                    <input 
                        type="${param.type || 'text'}" 
                        id="param-${param.name}" 
                        placeholder="${param.example || ''}"
                        class="form-input"
                    >
                `;
            }
        });
        form += '</div>';
        form += `
            <button onclick="sendPostRequest('${api.action}', ${JSON.stringify(api.params).replace(/"/g, '&quot;')})">
                Send Request
            </button>
        `;
    } else if (api.method === 'GET') {
        form += `
            <button onclick="window.open('${api.action}', '_blank')">
                Open in Browser
            </button>
        `;
    }
    
    form += '<button onclick="closeTestModal()">Close</button>';
    
    formContainer.innerHTML = form;
    testModal.style.display = 'block';
}

function sendPostRequest(endpoint, params) {
    const body = {};
    params.forEach(param => {
        const element = document.getElementById(`param-${param.name}`);
        const value = element ? element.value : '';
        
        // Only include non-empty values, or required fields (like text, query)
        if (value || param.name === 'text' || param.name === 'query') {
            if (value) { // Only add if has value
                body[param.name] = value;
            }
        }
    });
    
    const responseContainer = document.getElementById('responseContainer');
    responseContainer.innerHTML = '<p>Loading...</p>';
    
    fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })
    .then(async res => {
        const contentType = res.headers.get('content-type');
        
        // Handle binary responses (image/png, image/gif)
        if (contentType && (contentType.includes('image/png') || contentType.includes('image/gif'))) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const ext = contentType.includes('png') ? 'png' : 'gif';
            
            let html = '<h4>Response:</h4>';
            html += '<p style="margin-top: 15px;"><strong>Image Generated:</strong></p>';
            html += `<img src="${url}" style="max-width: 100%; max-height: 400px; border: 1px solid #ddd; border-radius: 5px; margin: 10px 0;">`;
            html += `<p><a href="${url}" download="generated.${ext}" style="color: #0066cc; cursor: pointer;">📥 Download Image</a></p>`;
            
            responseContainer.innerHTML = html;
            return null;
        }
        
        // Handle JSON responses
        return res.json();
    })
    .then(data => {
        if (data) { // Only process if it's JSON (not null from image handling)
            let html = '<h4>Response:</h4>';
            html += '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
            responseContainer.innerHTML = html;
        }
    })
    .catch(error => {
        responseContainer.innerHTML = '<p style="color: red;">Error: ' + error.message + '</p>';
    });
}

function createTestModal() {
    const modal = document.createElement('div');
    modal.id = 'testModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div id="formContainer"></div>
            <div id="responseContainer"></div>
        </div>
    `;
    document.body.appendChild(modal);
    
    modal.onclick = function(e) {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    };
}

function closeTestModal() {
    const modal = document.getElementById('testModal');
    if (modal) modal.style.display = 'none';
}

function toggleBratColorOptions() {
    const presetSelect = document.getElementById('param-preset');
    const bgColorField = document.getElementById('bgColor-field');
    const textColorField = document.getElementById('textColor-field');
    const bgColorInput = document.getElementById('param-bgColor');
    const textColorInput = document.getElementById('param-textColor');
    
    if (presetSelect && bgColorField && textColorField) {
        const isCustom = presetSelect.value === 'custom';
        bgColorField.style.display = isCustom ? 'block' : 'none';
        textColorField.style.display = isCustom ? 'block' : 'none';
        
        // Clear color values when switching away from custom
        if (!isCustom) {
            if (bgColorInput) bgColorInput.value = '';
            if (textColorInput) textColorInput.value = '';
        }
    }
}