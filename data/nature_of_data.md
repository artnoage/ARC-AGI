# Nature of the ARC Dataset JSON Files

This document describes the structure and content of the JSON files used in the Abstract Reasoning Corpus (ARC) dataset, typically found in directories like `data/training/` and `data/evaluation/`.

## File Structure

Each JSON file (e.g., `009d5c81.json`) represents a single ARC task. The root of the JSON is an object containing two main keys:

1.  **`train`**: An array (list) of demonstration examples for the task.
2.  **`test`**: An array (list) of test problems to be solved based on the pattern learned from the `train` examples.

```json
{
  "train": [ ... ],
  "test": [ ... ]
}
```

## Task Instance Structure

Both the `train` and `test` arrays contain one or more *task instances*. Each task instance is an object with two keys:

1.  **`input`**: A 2D array (list of lists) representing the input grid for the task instance.
2.  **`output`**: A 2D array (list of lists) representing the corresponding output grid for the task instance.

```json
{
  "input": [
    [0, 0, 0, ...],
    [0, 8, 8, ...],
    ...
  ],
  "output": [
    [0, 0, 0, ...],
    [0, 2, 2, ...],
    ...
  ]
}
```

### Grid Representation

-   The `input` and `output` grids are represented as lists of lists, where each inner list is a row in the grid.
-   The values within the grid are integers, typically ranging from 0 to 9. These integers represent different "colors" or states in the visual reasoning puzzle. `0` usually represents the background color.
-   The dimensions (height and width) of the input and output grids can vary between task instances and even between the input and output of a single instance.

## Purpose and Analogy

The dataset is designed for evaluating abstract reasoning capabilities. Each JSON file presents a unique reasoning challenge:

-   The `train` array provides 3-4 examples demonstrating a specific abstract pattern or transformation rule. The goal is to infer this rule.
-   The `test` array provides one or more input grids. The objective is to apply the inferred rule to these test inputs to generate the correct output grids.

This format is analogous to visual IQ tests where one must identify a pattern from examples and apply it to a new case.

## Merging and Metadata (`auxilary_utilities/merge_json.py`)

The script `auxilary_utilities/merge_json.py` is used to combine multiple individual task JSON files (like the ones in `data/evaluation/` or `data/training/`) into a single larger JSON file (e.g., `data/augmented.json` or `data/original.json`).

During this merging process, the script adds two metadata fields to each top-level task object *if they are not already present*:

1.  **`id`**: A string representing the original filename of the task JSON (e.g., "009d5c81"). This serves as a unique identifier for the task.
2.  **`created_by`**: A string indicating the creator or source, often set to "gkamradt".

Example structure after merging (conceptual, showing one task object within the merged list):

```json
[
  {
    "train": [ ... ],
    "test": [ ... ],
    "id": "009d5c81",
    "created_by": "gkamradt"
  },
  ... // Other task objects
]
```

This metadata helps in tracking and managing the individual tasks within the larger merged dataset.
