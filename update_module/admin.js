jQuery(document).ready(function($) {
    // Funcționalitatea este deja implementată în PHP cu JavaScript inline
    // Acest fișier este necesar doar pentru a satisface wp_enqueue_script
    
    // Funcții helper pentru a evita conflictele cu alte scripturi
    window.otsBulkZip = {
        // Funcția pentru testarea conexiunii FTP
        testFtpConnection: function() {
            const btn = document.getElementById('test-ftp-btn');
            if (!btn) return;
            
            btn.disabled = true;
            btn.innerHTML = '<span class="dashicons dashicons-update-alt spin"></span> Testez...';
            
            this.showStatus('<span class="dashicons dashicons-update-alt"></span> Testez conexiunea FTP...', 'loading');
            
            $.ajax({
                url: ots_ajax.ajaxurl,
                type: 'POST',
                data: {
                    action: 'ots_test_ftp_connection',
                    _ajax_nonce: ots_ajax.nonce
                },
                success: function(response) {
                    if (response.success) {
                        window.otsBulkZip.showStatus('<span class="dashicons dashicons-yes-alt"></span> Conexiune FTP reușită! Serverul este accesibil.', 'success');
                    } else {
                        window.otsBulkZip.showStatus('<span class="dashicons dashicons-dismiss"></span> Eroare conexiune: ' + response.data, 'error');
                    }
                },
                error: function(xhr, status, error) {
                    window.otsBulkZip.showStatus('<span class="dashicons dashicons-warning"></span> Eroare de rețea: ' + error, 'error');
                },
                complete: function() {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="dashicons dashicons-admin-network"></span> Testează Conexiunea';
                }
            });
        },
        
        // Funcția pentru listarea fișierelor FTP
        listFtpFiles: function() {
            const btn = document.getElementById('list-files-btn');
            if (!btn) return;
            
            btn.disabled = true;
            btn.innerHTML = '<span class="dashicons dashicons-update-alt spin"></span> Se încarcă...';
            
            document.getElementById('ftp-files').innerHTML = '<p style="padding: 20px; text-align: center;"><span class="dashicons dashicons-update-alt spin"></span> Se încarcă lista de fișiere...</p>';
            
            $.ajax({
                url: ots_ajax.ajaxurl,
                type: 'POST',
                data: {
                    action: 'ots_list_ftp_files',
                    _ajax_nonce: ots_ajax.nonce
                },
                success: function(response) {
                    if (response.success && response.data.length > 0) {
                        let html = '';
                        response.data.forEach(function(file) {
                            html += '<div class="ftp-file-item" onclick="window.otsBulkZip.toggleFileSelection(\'' + file.name + '\', this)">';
                            html += '<input type="checkbox" onchange="window.otsBulkZip.updateSelectedFiles()" onclick="event.stopPropagation();">';
                            html += '<div class="ftp-file-info">';
                            html += '<div class="ftp-file-name">' + file.name + '</div>';
                            html += '<div class="ftp-file-size">' + file.size + '</div>';
                            html += '</div>';
                            html += '</div>';
                        });
                        document.getElementById('ftp-files').innerHTML = html;
                        document.getElementById('ftp-install-form').style.display = 'block';
                        document.getElementById('refresh-files-btn').style.display = 'inline-block';
                        window.otsBulkZip.showStatus('<span class="dashicons dashicons-yes-alt"></span> S-au găsit ' + response.data.length + ' fișiere ZIP pe serverul FTP.', 'success');
                    } else {
                        document.getElementById('ftp-files').innerHTML = '<p style="padding: 20px; text-align: center; color: #666;">Nu s-au găsit fișiere ZIP în directorul specificat.</p>';
                        document.getElementById('ftp-install-form').style.display = 'none';
                        window.otsBulkZip.showStatus('<span class="dashicons dashicons-info"></span> Nu s-au găsit fișiere ZIP: ' + (response.data || 'Director gol'), 'error');
                    }
                },
                error: function(xhr, status, error) {
                    document.getElementById('ftp-files').innerHTML = '<p style="padding: 20px; text-align: center; color: #d63638;">Eroare la încărcarea fișierelor: ' + error + '</p>';
                    window.otsBulkZip.showStatus('<span class="dashicons dashicons-warning"></span> Eroare: ' + error, 'error');
                },
                complete: function() {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="dashicons dashicons-media-archive"></span> Listează Fișiere ZIP';
                }
            });
        },
        
        // Funcția pentru reîmprospătarea listei de fișiere
        refreshFtpFiles: function() {
            this.listFtpFiles();
        },
        
        // Funcția pentru toggle-ul selecției fișierelor
        toggleFileSelection: function(filename, element) {
            const checkbox = element.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            element.classList.toggle('selected', checkbox.checked);
            this.updateSelectedFiles();
        },
        
        // Funcția pentru actualizarea fișierelor selectate
        updateSelectedFiles: function() {
            const checkboxes = document.querySelectorAll('#ftp-files input[type="checkbox"]:checked');
            const selectedFiles = Array.from(checkboxes).map(function(cb) {
                return cb.closest('.ftp-file-item').querySelector('.ftp-file-name').textContent;
            });
            
            document.getElementById('selected_files').value = selectedFiles.join(',');
            
            if (selectedFiles.length > 0) {
                document.getElementById('selected-files-display').innerHTML = 
                    '<strong>' + selectedFiles.length + ' fișier' + (selectedFiles.length > 1 ? 'e' : '') + ' selectat' + (selectedFiles.length > 1 ? 'e' : '') + ':</strong><br>' + 
                    selectedFiles.join(', ');
            } else {
                document.getElementById('selected-files-display').innerHTML = 'Niciun fișier selectat';
            }
            
            const installBtn = document.getElementById('ftp-install-btn');
            if (installBtn) {
                installBtn.disabled = selectedFiles.length === 0;
            }
        },
        
        // Funcția pentru afișarea statusului
        showStatus: function(message, type) {
            const statusDiv = document.getElementById('ftp-status');
            if (statusDiv) {
                statusDiv.className = 'ftp-status ' + type;
                statusDiv.innerHTML = message;
            }
        }
    };
    
    // Adaugă CSS pentru animația de spin
    if (!document.getElementById('ots-bulk-zip-spin-style')) {
        const style = document.createElement('style');
        style.id = 'ots-bulk-zip-spin-style';
        style.textContent = `
            @keyframes spin { 
                from { transform: rotate(0deg); } 
                to { transform: rotate(360deg); } 
            }
            .spin { 
                animation: spin 1s linear infinite; 
            }
        `;
        document.head.appendChild(style);
    }
});
