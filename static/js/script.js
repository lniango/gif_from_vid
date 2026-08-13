// État de l'application
let state = {
    taskId: null,
    videoInfo: null,
    isProcessing: false,
    pollInterval: null
};

// Éléments DOM
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const videoInfo = document.getElementById('videoInfo');
const controls = document.getElementById('controls');
const convertBtn = document.getElementById('convertBtn');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const resultSection = document.getElementById('resultSection');
const gifPreview = document.getElementById('gifPreview');
const downloadBtn = document.getElementById('downloadBtn');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

// Sliders
const startTimeSlider = document.getElementById('startTime');
const durationSlider = document.getElementById('durationRange');
const fpsSlider = document.getElementById('fpsRange');
const widthSlider = document.getElementById('widthRange');

// Labels
const startTimeLabel = document.getElementById('startTimeLabel');
const durationLabel = document.getElementById('durationLabel');
const fpsLabel = document.getElementById('fpsLabel');
const widthLabel = document.getElementById('widthLabel');

// Gestion du drag & drop
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
});

uploadBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// Gestion des sliders
startTimeSlider.addEventListener('input', (e) => {
    startTimeLabel.textContent = e.target.value;
});

durationSlider.addEventListener('input', (e) => {
    durationLabel.textContent = e.target.value;
});

fpsSlider.addEventListener('input', (e) => {
    fpsLabel.textContent = e.target.value;
});

widthSlider.addEventListener('input', (e) => {
    widthLabel.textContent = e.target.value;
});

// Gestion du fichier
async function handleFile(file) {
    // Vérifier le type de fichier
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'];
    if (!allowedTypes.includes(file.type)) {
        showError('Format de fichier non supporté. Utilisez MP4, MOV, AVI, MKV ou WEBM.');
        return;
    }

    // Vérifier la taille (500MB max)
    if (file.size > 500 * 1024 * 1024) {
        showError('Le fichier est trop volumineux (max 500MB).');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('video', file);

        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            state.taskId = data.task_id;
            state.videoInfo = data.video_info;
            
            // Afficher les informations
            document.getElementById('duration').textContent = Math.round(data.video_info.duration);
            document.getElementById('resolution').textContent = `${data.video_info.width}x${data.video_info.height}`;
            document.getElementById('fps').textContent = Math.round(data.video_info.fps);
            
            // Ajuster les sliders
            const maxDuration = Math.min(10, Math.floor(data.video_info.duration));
            durationSlider.max = maxDuration;
            durationSlider.value = Math.min(10, maxDuration);
            durationLabel.textContent = durationSlider.value;
            
            startTimeSlider.max = Math.max(0, data.video_info.duration - 1);
            
            videoInfo.style.display = 'block';
            controls.style.display = 'block';
            resultSection.style.display = 'none';
            errorSection.style.display = 'none';
            
            showSuccess('Fichier uploadé avec succès !');
        } else {
            showError(data.error || 'Erreur lors de l\'upload');
        }
    } catch (error) {
        showError('Erreur de connexion au serveur');
        console.error(error);
    }
}

// Conversion
convertBtn.addEventListener('click', async () => {
    if (state.isProcessing) return;
    
    // Récupérer les paramètres
    const params = {
        start_time: parseFloat(startTimeSlider.value),
        duration: parseFloat(durationSlider.value),
        fps: parseInt(fpsSlider.value),
        width: parseInt(widthSlider.value)
    };
    
    state.isProcessing = true;
    convertBtn.disabled = true;
    convertBtn.textContent = '⏳ Conversion en cours...';
    
    // Afficher la progression
    progressSection.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    resultSection.style.display = 'none';
    errorSection.style.display = 'none';
    
    try {
        const response = await fetch('/convert', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                task_id: state.taskId,
                params: params
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Démarrer le polling pour la progression
            startPolling();
        } else {
            showError(data.error || 'Erreur lors de la conversion');
            state.isProcessing = false;
            convertBtn.disabled = false;
            convertBtn.textContent = '🔄 Convertir en GIF';
        }
    } catch (error) {
        showError('Erreur de connexion au serveur');
        state.isProcessing = false;
        convertBtn.disabled = false;
        convertBtn.textContent = '🔄 Convertir en GIF';
        console.error(error);
    }
});

// Polling pour la progression
function startPolling() {
    if (state.pollInterval) {
        clearInterval(state.pollInterval);
    }
    
    state.pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`/progress/${state.taskId}`);
            const data = await response.json();
            
            if (response.ok) {
                // Mettre à jour la progression
                progressFill.style.width = `${data.progress}%`;
                progressText.textContent = `${data.progress}%`;
                
                if (data.status === 'completed') {
                    // Conversion terminée
                    clearInterval(state.pollInterval);
                    state.pollInterval = null;
                    state.isProcessing = false;
                    convertBtn.disabled = false;
                    convertBtn.textContent = '🔄 Convertir en GIF';
                    
                    // Afficher le résultat
                    gifPreview.src = data.output_file;
                    resultSection.style.display = 'block';
                    
                    // Configurer le téléchargement
                    downloadBtn.onclick = () => {
                        window.location.href = data.output_file;
                    };
                    
                    showSuccess('Conversion terminée avec succès !');
                    
                } else if (data.status === 'error') {
                    // Erreur
                    clearInterval(state.pollInterval);
                    state.pollInterval = null;
                    state.isProcessing = false;
                    convertBtn.disabled = false;
                    convertBtn.textContent = '🔄 Convertir en GIF';
                    showError(data.error || 'Erreur lors de la conversion');
                }
            }
        } catch (error) {
            console.error('Erreur lors du polling:', error);
        }
    }, 500); // Polling toutes les 500ms
}

// Fonctions utilitaires
function showError(message) {
    errorSection.style.display = 'block';
    errorText.textContent = '❌ ' + message;
    setTimeout(() => {
        errorSection.style.display = 'none';
    }, 5000);
}

function showSuccess(message) {
    // Pas de section dédiée pour les succès, on peut utiliser une notification temporaire
    const successDiv = document.createElement('div');
    successDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #48bb78;
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    successDiv.textContent = '✅ ' + message;
    document.body.appendChild(successDiv);
    
    setTimeout(() => {
        successDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(successDiv);
        }, 300);
    }, 3000);
}

// Ajouter les animations CSS dynamiquement
const styleSheet = document.createElement("style");
styleSheet.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(styleSheet);

// Nettoyage lors de la fermeture de la page
window.addEventListener('beforeunload', () => {
    if (state.pollInterval) {
        clearInterval(state.pollInterval);
    }
});

console.log('🎬 Convertisseur Vidéo → GIF prêt !');
