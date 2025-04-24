import os
import json

# Define paths
data_dir = 'data'
training_dir = os.path.join(data_dir, 'training')
evaluation_dir = os.path.join(data_dir, 'evaluation')
original_json_path = os.path.join(data_dir, 'original.json')
augmented_json_path = os.path.join(data_dir, 'augmented.json')

# Count files in training directory
try:
    training_files = [f for f in os.listdir(training_dir) if f.endswith('.json')]
    training_count = len(training_files)
    print(f"Number of datapoints (JSON files) in training: {training_count}")
except FileNotFoundError:
    print(f"Error: Training directory not found at {training_dir}")
    training_count = 0

# Count files in evaluation directory
try:
    evaluation_files = [f for f in os.listdir(evaluation_dir) if f.endswith('.json')]
    evaluation_count = len(evaluation_files)
    print(f"Number of datapoints (JSON files) in evaluation: {evaluation_count}")
except FileNotFoundError:
    print(f"Error: Evaluation directory not found at {evaluation_dir}")
    evaluation_count = 0

# Count entries in original.json
try:
    with open(original_json_path, 'r') as f:
        original_data = json.load(f)
        # Assuming the JSON root is a list or dict
        original_count = len(original_data) if isinstance(original_data, (list, dict)) else 'N/A (Not a list/dict)'
        print(f"Number of entries in original.json: {original_count}")
except FileNotFoundError:
    print(f"Error: original.json not found at {original_json_path}")
    original_count = 0
except json.JSONDecodeError:
    print(f"Error: Could not decode JSON from {original_json_path}")
    original_count = 'N/A (JSON Error)'

# Count entries in augmented.json
try:
    with open(augmented_json_path, 'r') as f:
        augmented_data = json.load(f)
        # Assuming the JSON root is a list or dict
        augmented_count = len(augmented_data) if isinstance(augmented_data, (list, dict)) else 'N/A (Not a list/dict)'
        print(f"Number of entries in augmented.json: {augmented_count}")
except FileNotFoundError:
    print(f"Error: augmented.json not found at {augmented_json_path}")
    augmented_count = 0
except json.JSONDecodeError:
    print(f"Error: Could not decode JSON from {augmented_json_path}")
    augmented_count = 'N/A (JSON Error)'

print("\nSummary:")
print(f"- Training files: {training_count}")
print(f"- Evaluation files: {evaluation_count}")
print(f"- Original.json entries: {original_count}")
print(f"- Augmented.json entries: {augmented_count}")
