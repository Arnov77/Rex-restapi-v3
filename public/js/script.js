// Real-time Clock
setInterval(() => {
    const now = new Date();
    document.getElementById('time').innerText = now.toLocaleTimeString();
}, 1000);

fetch('data/apis.json')
    .then(response => response.json())
    .then(data => {
        const main = document.querySelector('main');
        let content = ''; // Variabel untuk semua tabel

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
                                        <td>${api.method}</td>
                                        <td><button class="try-btn" onclick="window.open('${api.action}', '_blank')">Try</button></td>
                                    </tr>`
                                )
                                .join('')}
                        </tbody>
                    </table>
                </section>
            `;
        }

        main.innerHTML = content; // Tambahkan semua kategori ke dalam main
    })
    .catch(error => console.error('Error loading API list:', error));

    function openApi(relativeUrl) {
        const fullUrl = relativeUrl.startsWith("http") ? relativeUrl : `${window.location.origin}${relativeUrl}`;
        window.open(fullUrl, '_blank');
    }