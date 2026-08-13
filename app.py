import os
import subprocess
import json
import time
from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import threading
import uuid
from pathlib import Path

app = Flask(__name__)
CORS(app)

# Configuration
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['OUTPUT_FOLDER'] = 'outputs'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max
app.config['ALLOWED_EXTENSIONS'] = {'mp4', 'mov', 'avi', 'mkv', 'webm'}

# Créer les dossiers nécessaires¨
Path(app.config['UPLOAD_FOLDER']).mkdir(exist_ok=True)
Path(app.config['OUTPUT_FOLDER']).mkdir(exist_ok=True)

# Stockage des tâches en cours
tasks = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def get_video_info(filepath):
    """Récupère les informations de la vidéo"""
    try:
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            '-show_format',
            filepath
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        data = json.loads(result.stdout)
        
        # Trouver le stream vidéo
        video_stream = next((s for s in data['streams'] if s['codec_type'] == 'video'), None)
        if video_stream:
            return {
                'duration': float(data['format']['duration']),
                'width': int(video_stream['width']),
                'height': int(video_stream['height']),
                'fps': eval(video_stream.get('r_frame_rate', '0/1'))
            }
    except Exception as e:
        print(f"Erreur lors de la lecture des infos vidéo: {e}")
    return None

def convert_video_to_gif(task_id, input_path, output_path, params):
    """Convertit la vidéo en GIF avec FFmpeg"""
    try:
        # Paramètres
        start_time = params.get('start_time', 0)
        duration = params.get('duration', 10)
        width = params.get('width', 480)
        fps = params.get('fps', 15)
        
        # Construction de la commande FFmpeg
        cmd = [
            'ffmpeg',
            '-i', input_path,
            '-ss', str(start_time),
            '-t', str(duration),
            '-vf', f'fps={fps},scale={width}:-1:flags=lanczos',
            '-c:v', 'gif',
            '-f', 'gif',
            '-y',  # Écraser le fichier existant
            output_path
        ]
        
        # Exécuter FFmpeg et capturer la sortie
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )
        
        # Lire la sortie pour la progression
        while True:
            output = process.stderr.readline()
            if output == '' and process.poll() is not None:
                break
            if output:
                # Extraire le temps de la sortie FFmpeg
                if 'time=' in output:
                    time_str = output.split('time=')[1].split(' ')[0]
                    try:
                        # Convertir le temps en secondes
                        if ':' in time_str:
                            parts = time_str.split(':')
                            if len(parts) == 3:
                                seconds = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                            else:
                                seconds = float(time_str)
                            progress = min(100, int((seconds / duration) * 100))
                            tasks[task_id]['progress'] = progress
                    except:
                        pass
        
        # Vérifier si la conversion a réussi
        if process.returncode == 0 and os.path.exists(output_path):
            tasks[task_id]['status'] = 'completed'
            tasks[task_id]['progress'] = 100
            tasks[task_id]['output_file'] = output_path
            return True
        else:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = 'Erreur lors de la conversion'
            return False
            
    except Exception as e:
        tasks[task_id]['status'] = 'error'
        tasks[task_id]['error'] = str(e)
        return False

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'video' not in request.files:
        return jsonify({'error': 'Aucun fichier envoyé'}), 400
    
    file = request.files['video']
    if file.filename == '':
        return jsonify({'error': 'Nom de fichier vide'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Format de fichier non supporté'}), 400
    
    try:
        # Générer un ID unique pour la tâche
        task_id = str(uuid.uuid4())
        
        # Sauvegarder le fichier
        filename = secure_filename(file.filename)
        input_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{task_id}_{filename}")
        file.save(input_path)
        
        # Récupérer les informations de la vidéo
        video_info = get_video_info(input_path)
        if not video_info:
            return jsonify({'error': 'Impossible de lire le fichier vidéo'}), 400
        
        # Créer la tâche
        tasks[task_id] = {
            'status': 'uploaded',
            'input_path': input_path,
            'video_info': video_info,
            'progress': 0,
            'output_file': None,
            'error': None
        }
        
        return jsonify({
            'task_id': task_id,
            'video_info': video_info
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/convert', methods=['POST'])
def convert():
    data = request.json
    task_id = data.get('task_id')
    params = data.get('params', {})
    
    if task_id not in tasks:
        return jsonify({'error': 'Tâche introuvable'}), 404
    
    task = tasks[task_id]
    if task['status'] == 'error':
        return jsonify({'error': task['error']}), 400
    
    try:
        # Générer le nom du fichier de sortie
        output_filename = f"{task_id}.gif"
        output_path = os.path.join(app.config['OUTPUT_FOLDER'], output_filename)
        
        # Mettre à jour le statut
        task['status'] = 'processing'
        
        # Lancer la conversion dans un thread séparé
        thread = threading.Thread(
            target=convert_video_to_gif,
            args=(task_id, task['input_path'], output_path, params)
        )
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'status': 'processing',
            'task_id': task_id
        })
        
    except Exception as e:
        task['status'] = 'error'
        task['error'] = str(e)
        return jsonify({'error': str(e)}), 500

@app.route('/progress/<task_id>')
def get_progress(task_id):
    if task_id not in tasks:
        return jsonify({'error': 'Tâche introuvable'}), 404
    
    task = tasks[task_id]
    response = {
        'status': task['status'],
        'progress': task.get('progress', 0)
    }
    
    if task['status'] == 'completed':
        response['output_file'] = f"/download/{task_id}"
    
    if task['status'] == 'error':
        response['error'] = task.get('error', 'Erreur inconnue')
    
    return jsonify(response)

@app.route('/download/<task_id>')
def download_file(task_id):
    if task_id not in tasks:
        return jsonify({'error': 'Tâche introuvable'}), 404
    
    task = tasks[task_id]
    if task['status'] != 'completed' or not task.get('output_file'):
        return jsonify({'error': 'Fichier non disponible'}), 404
    
    return send_file(
        task['output_file'],
        as_attachment=True,
        download_name='converted.gif',
        mimetype='image/gif'
    )

@app.route('/cleanup', methods=['POST'])
def cleanup():
    """Nettoie les fichiers temporaires"""
    try:
        for task_id, task in list(tasks.items()):
            if task['status'] in ['completed', 'error']:
                # Supprimer les fichiers
                if os.path.exists(task['input_path']):
                    os.remove(task['input_path'])
                if task.get('output_file') and os.path.exists(task['output_file']):
                    os.remove(task['output_file'])
                del tasks[task_id]
        return jsonify({'status': 'cleanup successful'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)