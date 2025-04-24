import os
import json
import logging
import time
import shutil # For file copying
from datetime import datetime, timedelta # For timestamp comparison
from flask import Flask, send_from_directory, jsonify, request
from flask_socketio import SocketIO, emit

# --- Configuration ---
logging.basicConfig(level=logging.INFO)
APP_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(APP_DIR, 'data')
BACKUP_DIR = os.path.join(DATA_DIR, 'backups') # Backup directory
APPS_STATIC_DIR = os.path.join(APP_DIR, 'apps')
TRACE_STORE_FILE = os.path.join(DATA_DIR, 'traces_store.json')
BACKUP_INTERVAL = timedelta(hours=1) # Backup interval (1 hour)

# --- Flask App Setup ---
app = Flask(__name__, static_folder=None) # Disable default static folder
app.config['SECRET_KEY'] = 'your_secret_key_here!' # Change this in production!
socketio = SocketIO(app, cors_allowed_origins="*") # Allow all origins for now

# --- Data Loading ---
base_task_data = {}
trace_data = {}

def load_base_task_data(dataset_name):
    """Loads original or augmented task data."""
    filepath = os.path.join(DATA_DIR, f"{dataset_name}.json")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            logging.info(f"Successfully loaded base data for '{dataset_name}' from {filepath}")
            return data
    except FileNotFoundError:
        logging.error(f"Base data file not found: {filepath}")
        return None
    except json.JSONDecodeError:
        logging.error(f"Invalid JSON in base data file: {filepath}")
        return None
    except Exception as e:
        logging.error(f"Error loading base data file {filepath}: {e}")
        return None

def load_trace_data():
    """Loads trace data from the JSON store."""
    global trace_data
    try:
        if os.path.exists(TRACE_STORE_FILE):
            with open(TRACE_STORE_FILE, 'r', encoding='utf-8') as f:
                trace_data = json.load(f)
                logging.info(f"Loaded trace data from {TRACE_STORE_FILE}")
        else:
            trace_data = {} # Initialize if file doesn't exist
            logging.info(f"Trace store file not found ({TRACE_STORE_FILE}), initializing empty store.")
    except json.JSONDecodeError:
        logging.error(f"Invalid JSON in trace store file: {TRACE_STORE_FILE}. Initializing empty store.")
        trace_data = {}
    except Exception as e:
        logging.error(f"Error loading trace store file {TRACE_STORE_FILE}: {e}")
        trace_data = {} # Fallback to empty

def save_trace_data():
    """Saves the current trace data to the JSON store."""
    try:
        with open(TRACE_STORE_FILE, 'w', encoding='utf-8') as f:
            json.dump(trace_data, f, indent=2) # Use indent for readability
            logging.debug(f"Saved trace data to {TRACE_STORE_FILE}")
    except Exception as e:
        logging.error(f"Error saving trace store file {TRACE_STORE_FILE}: {e}")
    finally:
        # Attempt backup regardless of main save success, but log potential issues
        try:
            backup_trace_data_hourly()
        except Exception as backup_e:
            logging.error(f"Error during hourly backup process: {backup_e}")


def backup_trace_data_hourly():
    """Creates a timestamped backup of the trace store if the last backup is older than BACKUP_INTERVAL."""
    try:
        # Ensure backup directory exists
        os.makedirs(BACKUP_DIR, exist_ok=True)

        # Find the latest backup file
        latest_backup_time = None
        backup_files = [f for f in os.listdir(BACKUP_DIR) if f.startswith('traces_store_') and f.endswith('.json')]
        if backup_files:
            timestamps = []
            for fname in backup_files:
                try:
                    # Extract timestamp string (YYYYMMDD_HHMMSS)
                    ts_str = fname.replace('traces_store_', '').replace('.json', '')
                    timestamps.append(datetime.strptime(ts_str, '%Y%m%d_%H%M%S'))
                except ValueError:
                    logging.warning(f"Could not parse timestamp from backup filename: {fname}")
            if timestamps:
                latest_backup_time = max(timestamps)

        # Check if backup is needed
        now = datetime.now()
        should_backup = False
        if latest_backup_time is None:
            should_backup = True # First backup
            logging.info("No previous backups found. Creating initial backup.")
        elif now - latest_backup_time >= BACKUP_INTERVAL:
            should_backup = True
            logging.info(f"Last backup ({latest_backup_time}) is older than {BACKUP_INTERVAL}. Creating new backup.")
        else:
            logging.debug(f"Last backup ({latest_backup_time}) is recent. Skipping backup.")

        # Perform backup if needed
        if should_backup:
            if not os.path.exists(TRACE_STORE_FILE):
                logging.warning(f"Trace store file {TRACE_STORE_FILE} does not exist. Cannot create backup.")
                return

            timestamp_str = now.strftime('%Y%m%d_%H%M%S')
            backup_filename = f"traces_store_{timestamp_str}.json"
            backup_filepath = os.path.join(BACKUP_DIR, backup_filename)
            shutil.copy2(TRACE_STORE_FILE, backup_filepath) # copy2 preserves metadata
            logging.info(f"Successfully created backup: {backup_filepath}")

    except Exception as e:
        logging.error(f"Failed to perform hourly backup: {e}")


# Load initial data on startup
base_task_data['original'] = load_base_task_data('original')
base_task_data['augmented'] = load_base_task_data('augmented')
load_trace_data()

# --- HTTP Routes ---
@app.route('/')
def index():
    """Serves the testing interface directly."""
    return send_from_directory(APPS_STATIC_DIR, 'testing_interface.html')

@app.route('/apps/<path:filename>')
def serve_apps_files(filename):
    """Serves static files from the apps directory (js, css, html)."""
    return send_from_directory(APPS_STATIC_DIR, filename)

@app.route('/data/<dataset_name>.json')
def serve_base_data(dataset_name):
    """Serves the base original/augmented JSON data."""
    if dataset_name in base_task_data and base_task_data[dataset_name] is not None:
        return jsonify(base_task_data[dataset_name])
    else:
        return jsonify({"error": f"Dataset '{dataset_name}' not found or failed to load."}), 404

# --- WebSocket Event Handlers ---
@socketio.on('connect')
def handle_connect():
    logging.info(f"Client connected: {request.sid}")
    emit('connection_ack', {'message': 'Connected to server'})

@socketio.on('disconnect')
def handle_disconnect():
    logging.info(f"Client disconnected: {request.sid}")

@socketio.on('request_traces')
def handle_request_traces(data):
    """Client requests traces for a specific task."""
    task_id = data.get('task_id')
    sid = request.sid
    logging.info(f"Client {sid} requested traces for task_id: {task_id}")
    if task_id:
        task_traces = trace_data.get(task_id, [])
        emit('initial_traces', {'task_id': task_id, 'traces': task_traces}, room=sid)
        logging.debug(f"Sent {len(task_traces)} traces for task {task_id} to client {sid}")
    else:
        logging.warning(f"Client {sid} sent 'request_traces' without task_id.")

@socketio.on('add_trace')
def handle_add_trace(data):
    """Client adds a new trace."""
    task_id = data.get('task_id')
    username = data.get('username', 'Anonymous') # Default username
    text = data.get('text')
    sid = request.sid

    logging.info(f"Client {sid} adding trace for task {task_id} by {username}")

    if not task_id or not text:
        logging.warning(f"Client {sid} sent incomplete 'add_trace' data.")
        emit('trace_error', {'message': 'Missing task_id or text for adding trace.'}, room=sid)
        return

    # Create new trace object
    # TODO: Generate a truly unique trace ID (e.g., UUID)
    trace_id = f"{task_id}_{username}_{socketio.server.eio.generate_id()[:8]}" # Simple unique enough ID for now
    new_trace = {
        'trace_id': trace_id,
        'task_id': task_id,
        'username': username,
        'text': text,
        'score': 0,
        'timestamp': time.time(), # Use standard time module for timestamp
        'voters': {} # Initialize empty voters dict
    }

    # Add to in-memory store
    if task_id not in trace_data:
        trace_data[task_id] = []
    trace_data[task_id].append(new_trace)

    # Save to file (consider debouncing or batching writes later for performance)
    save_trace_data()

    # Broadcast the new trace to all connected clients
    # TODO: Ideally, only broadcast to clients interested in this task_id
    emit('new_trace', new_trace, broadcast=True)
    logging.info(f"Broadcasted new trace {trace_id} for task {task_id}")

@socketio.on('vote_trace')
def handle_vote_trace(data):
    """Client votes on a trace."""
    trace_id = data.get('trace_id')
    username = data.get('username', 'Anonymous')
    vote = data.get('vote') # Should be +1 or -1
    sid = request.sid

    logging.info(f"Client {sid} ({username}) voting {vote} on trace {trace_id}")

    if not trace_id or not username or vote not in [1, -1]:
        logging.warning(f"Client {sid} sent invalid 'vote_trace' data.")
        emit('trace_error', {'message': 'Invalid vote data.'}, room=sid)
        return

    # Find the trace
    target_trace = None
    task_id_of_trace = None
    for task_id, traces in trace_data.items():
        for trace in traces:
            if trace.get('trace_id') == trace_id:
                target_trace = trace
                task_id_of_trace = task_id
                break
        if target_trace:
            break

    if not target_trace:
        logging.warning(f"Client {sid} tried to vote on non-existent trace {trace_id}")
        emit('trace_error', {'message': f'Trace ID {trace_id} not found.'}, room=sid)
        return

    # Check if user already voted this way
    current_vote = target_trace.get('voters', {}).get(username, 0)

    if current_vote == vote:
        logging.debug(f"User {username} already voted {vote} on trace {trace_id}. No change.")
        # Optionally inform the user they already voted
        # emit('vote_ack', {'trace_id': trace_id, 'score': target_trace['score'], 'message': 'Already voted.'}, room=sid)
        return

    # Update score and voter record
    # If user voted oppositely before, the change is doubled (e.g., -1 to +1 is +2 change)
    score_change = vote - current_vote
    target_trace['score'] = target_trace.get('score', 0) + score_change
    if 'voters' not in target_trace: target_trace['voters'] = {}
    target_trace['voters'][username] = vote

    # Save changes
    save_trace_data()

    # Broadcast the updated trace score/info
    # TODO: Only broadcast to clients interested in this task_id
    updated_trace_info = {
        'trace_id': trace_id,
        'task_id': task_id_of_trace,
        'score': target_trace['score']
        # Optionally include updated voters dict if frontend needs it
    }
    emit('trace_updated', updated_trace_info, broadcast=True)
    logging.info(f"Broadcasted updated score for trace {trace_id} (New score: {target_trace['score']})")


# --- Main Execution ---
if __name__ == '__main__':
    print("Starting Flask-SocketIO server...")
    print(f"Serving index from: {APP_DIR}")
    print(f"Serving app files from: {APPS_STATIC_DIR}")
    print(f"Using trace store: {TRACE_STORE_FILE}")
    # Use host='0.0.0.0' to make it accessible on the network
    # Use debug=True for development (auto-reloads), but disable in production
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, use_reloader=True)
