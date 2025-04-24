import json
import os
import argparse

def merge_json_files(input_folder, output_file):
    """
    Merges JSON files from an input folder into a single output file.

    Handles both individual JSON objects and lists of objects within files.
    """
    merged_data = []

    if not os.path.isdir(input_folder):
        print(f"Error: Input folder '{input_folder}' not found or is not a directory.")
        return

    for filename in os.listdir(input_folder):
        if filename.endswith(".json"):
            filepath = os.path.join(input_folder, filename)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = json.load(f)
                    file_id = os.path.splitext(filename)[0] # Get file ID

                    if isinstance(content, list):
                        processed_list = []
                        for item in content:
                            # Ensure item is a dictionary before checking/adding 'id'
                            if isinstance(item, dict) and 'id' not in item:
                                item['id'] = file_id
                            processed_list.append(item) # Append modified or original item
                        merged_data.extend(processed_list) # Extend with processed items
                    elif isinstance(content, dict):
                        # Ensure content is a dictionary before checking/adding 'id'
                        if 'id' not in content:
                            content['id'] = file_id
                        merged_data.append(content) # Append modified or original object
                    else:
                        # If content is not a list or dict (e.g., string, number), append directly
                        merged_data.append(content)
            except json.JSONDecodeError:
                print(f"Warning: Skipping file '{filename}' due to invalid JSON format.")
            except Exception as e:
                print(f"Warning: Error processing file '{filename}': {e}")

    try:
        # Ensure the output directory exists
        output_dir = os.path.dirname(output_file)
        if output_dir and not os.path.exists(output_dir):
             os.makedirs(output_dir)

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(merged_data, f, indent=4) # Use indent for readability
        print(f"Successfully merged JSON files from '{input_folder}' into '{output_file}'")
    except Exception as e:
        print(f"Error writing to output file '{output_file}': {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Merge JSON files from a folder into a single output file.")
    parser.add_argument("input_folder", help="Path to the folder containing JSON files to merge.")
    parser.add_argument("output_file", help="Path to the output JSON file.")

    args = parser.parse_args()

    merge_json_files(args.input_folder, args.output_file)
