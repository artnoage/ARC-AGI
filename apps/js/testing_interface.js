// Internal state.
var CURRENT_INPUT_GRID = new Grid(3, 3);
var CURRENT_OUTPUT_GRID = new Grid(3, 3);
var TEST_PAIRS = new Array(); // Test pairs for the *currently loaded* task
var CURRENT_TEST_PAIR_INDEX = 0;
var COPY_PASTE_DATA = new Array();
var LOADED_TASK_LIST = []; // Holds the list of tasks from the loaded dataset
var CURRENT_TASK_INDEX = -1; // Index in LOADED_TASK_LIST
var CURRENT_DATASET_NAME = null; // 'original' or 'augmented'
var TASK_ID_MAP = {}; // Map task IDs to their index in LOADED_TASK_LIST
var CURRENT_TRACE_INDEX = 0; // Index of the currently viewed trace for the active task
var USERNAME = "Anonymous"; // Default username, will be updated from input
var socket = null; // WebSocket connection object

// Cosmetic.
var EDITION_GRID_HEIGHT = 500;
var EDITION_GRID_WIDTH = 500;
var MAX_CELL_SIZE = 100;


function resetTask(isListNavigation = false) {
    // Reset grids and current test pair index for the new task
    CURRENT_INPUT_GRID = new Grid(3, 3);
    TEST_PAIRS = new Array();
    CURRENT_TEST_PAIR_INDEX = 0;
    $('#task_preview').html(''); // Clear old demonstration pairs
    resetOutputGrid(); // Reset the output grid editor

    // Only fully reset list/dataset state if not just navigating within the list
    if (!isListNavigation) {
        LOADED_TASK_LIST = [];
        CURRENT_TASK_INDEX = -1;
        TASK_ID_MAP = {};
        CURRENT_DATASET_NAME = null; // Clear dataset name unless reloading same one
        $('#list_navigation').hide();
        $('#task_index_display').text('');
        $('#loaded_dataset_display').text('');
        $('#goto_id_controls').hide();
        // Comment section visibility is handled by loadDataset/initial state now
        // $('#comment_section').hide();
        CURRENT_TRACE_INDEX = 0; // Reset trace index
    }

    $('#error_display').hide();
    $('#info_display').hide();
    // Also reset trace display area on task reset
    $('#comment_display_area').text('No reasoning traces added yet.');
    $('#comment_score_display').text('0');
    $('#comment_nav_display').text('Trace -/-');
    $('#prev_comment_btn').prop('disabled', true);
    $('#next_comment_btn').prop('disabled', true);
    $('#upvote_btn').prop('disabled', true);
    $('#downvote_btn').prop('disabled', true);
}

function refreshEditionGrid(jqGrid, dataGrid) {
    fillJqGridWithData(jqGrid, dataGrid);
    setUpEditionGridListeners(jqGrid);
    fitCellsToContainer(jqGrid, dataGrid.height, dataGrid.width, EDITION_GRID_HEIGHT, EDITION_GRID_HEIGHT);
    initializeSelectable();
}

function syncFromEditionGridToDataGrid() {
    copyJqGridToDataGrid($('#output_grid .edition_grid'), CURRENT_OUTPUT_GRID);
}

function syncFromDataGridToEditionGrid() {
    refreshEditionGrid($('#output_grid .edition_grid'), CURRENT_OUTPUT_GRID);
}

function getSelectedSymbol() {
    selected = $('#symbol_picker .selected-symbol-preview')[0];
    return $(selected).attr('symbol');
}

function setUpEditionGridListeners(jqGrid) {
    jqGrid.find('.cell').click(function(event) {
        cell = $(event.target);
        symbol = getSelectedSymbol();

        mode = $('input[name=tool_switching]:checked').val();
        if (mode == 'floodfill') {
            // If floodfill: fill all connected cells.
            syncFromEditionGridToDataGrid();
            grid = CURRENT_OUTPUT_GRID.grid;
            floodfillFromLocation(grid, cell.attr('x'), cell.attr('y'), symbol);
            syncFromDataGridToEditionGrid();
        }
        else if (mode == 'edit') {
            // Else: fill just this cell.
            setCellSymbol(cell, symbol);
        }
        // Update distance after any edit/floodfill action
        updateDistanceDisplay();
    });
}

function resizeOutputGrid() {
    size = $('#output_grid_size').val();
    size = parseSizeTuple(size);
    height = size[0];
    width = size[1];

    jqGrid = $('#output_grid .edition_grid');
    syncFromEditionGridToDataGrid();
    dataGrid = JSON.parse(JSON.stringify(CURRENT_OUTPUT_GRID.grid));
    CURRENT_OUTPUT_GRID = new Grid(height, width, dataGrid);
    refreshEditionGrid(jqGrid, CURRENT_OUTPUT_GRID);
    updateDistanceDisplay(); // Update distance after resize
}

function resetOutputGrid() {
    syncFromEditionGridToDataGrid();
    CURRENT_OUTPUT_GRID = new Grid(3, 3);
    syncFromDataGridToEditionGrid();
    resizeOutputGrid(); // This already calls refreshEditionGrid and updateDistanceDisplay
    // updateDistanceDisplay(); // No need to call again, resizeOutputGrid handles it
}

function copyFromInput() {
    syncFromEditionGridToDataGrid();
    CURRENT_OUTPUT_GRID = convertSerializedGridToGridObject(CURRENT_INPUT_GRID.grid);
    syncFromDataGridToEditionGrid();
    $('#output_grid_size').val(CURRENT_OUTPUT_GRID.height + 'x' + CURRENT_OUTPUT_GRID.width);
    updateDistanceDisplay(); // Update distance after copy
}

function fillPairPreview(pairId, inputGrid, outputGrid) {
    var pairSlot = $('#pair_preview_' + pairId);
    if (!pairSlot.length) {
        // Create HTML for pair.
        pairSlot = $('<div id="pair_preview_' + pairId + '" class="pair_preview" index="' + pairId + '"></div>');
        pairSlot.appendTo('#task_preview');
    }
    var jqInputGrid = pairSlot.find('.input_preview');
    if (!jqInputGrid.length) {
        jqInputGrid = $('<div class="input_preview"></div>');
        jqInputGrid.appendTo(pairSlot);
    }
    var jqOutputGrid = pairSlot.find('.output_preview');
    if (!jqOutputGrid.length) {
        jqOutputGrid = $('<div class="output_preview"></div>');
        jqOutputGrid.appendTo(pairSlot);
    }

    // Fill the grids first
    fillJqGridWithData(jqInputGrid, inputGrid);
    fillJqGridWithData(jqOutputGrid, outputGrid);

    // Define fixed, smaller constraints for the preview grids.
    const previewConstraint = 150; // Use 150x150 box constraint

    // Fit cells using the fixed constraints.
    // fitCellsToContainer calculates the best proportional size within these bounds.
    fitCellsToContainer(jqInputGrid, inputGrid.height, inputGrid.width, previewConstraint, previewConstraint);
    fitCellsToContainer(jqOutputGrid, outputGrid.height, outputGrid.width, previewConstraint, previewConstraint);
}

// Loads a single task object into the UI (assumes username is validated and welcome screen is hidden)
function loadSingleTask(taskObject, taskName) {
    // Reset UI elements specific to a single task load
    resetTask(CURRENT_TASK_INDEX !== -1); // Pass true if navigating a list
    // Modal is removed, no need to hide it.

    try {
        train = taskObject['train'];
        test = taskObject['test'];
        if (!train || !test) {
            throw new Error("Task object missing 'train' or 'test' fields.");
        }
    } catch (e) {
        errorMsg(`Error processing task ${taskName}: ${e.message}`);
        // If loading the first task from a list fails, clear the list state
        if (CURRENT_TASK_INDEX === 0) {
            LOADED_TASK_LIST = [];
            CURRENT_TASK_INDEX = -1;
            $('#list_navigation').hide();
        }
        return; // Stop loading this task
    }


    // Load training pairs
    for (var i = 0; i < train.length; i++) {
        pair = train[i];
        values = pair['input'];
        input_grid = convertSerializedGridToGridObject(values)
        values = pair['output'];
        output_grid = convertSerializedGridToGridObject(values)
        fillPairPreview(i, input_grid, output_grid);
    }
    for (var i=0; i < test.length; i++) {
        pair = test[i];
        TEST_PAIRS.push(pair);
    }
    // Handle cases where there might be no test pairs
    if (TEST_PAIRS.length > 0 && TEST_PAIRS[0]['input']) {
        values = TEST_PAIRS[0]['input'];
        CURRENT_INPUT_GRID = convertSerializedGridToGridObject(values);
        fillTestInput(CURRENT_INPUT_GRID);
        CURRENT_TEST_PAIR_INDEX = 0;
        $('#current_test_input_id_display').html('1');
    } else {
        // No test pairs or invalid first test pair
        $('#evaluation_input').html(''); // Clear input grid display
        CURRENT_INPUT_GRID = new Grid(3, 3); // Reset grid
        CURRENT_TEST_PAIR_INDEX = -1; // Indicate no valid test index
         $('#current_test_input_id_display').html('0');
    }
    $('#total_test_input_count_display').html(test.length);


    // Update task name display using the task's ID if available
    display_task_name(taskObject.id || taskName); // Prefer task ID for display name

    // Update list navigation UI
    updateListNavigationUI();

    // Request traces from server for this task
    const taskId = taskObject.id;
    if (socket && socket.connected && taskId) {
        console.log(`Requesting traces for task ID: ${taskId}`);
        socket.emit('request_traces', { task_id: taskId });
    } else if (!taskId) {
        console.warn("Cannot request traces: Task ID is missing.");
        // Proceed without server-side traces for this task
        displayTraces(); // Display local/empty traces
    } else {
        console.error("Cannot request traces: WebSocket not connected.");
        errorMsg("Not connected to real-time server. Cannot load traces.");
        // Proceed without server-side traces for this task
        displayTraces(); // Display local/empty traces
    }

    // Note: displayTraces() will now be primarily triggered by the 'initial_traces' event handler
    // The comment section is shown after successful load, trace display handled by displayTraces/socket events
    $('#comment_section').show(); // Ensure comment section is visible for the loaded task
    $('#comment_display_area').text('Loading traces...'); // Placeholder until socket response
    $('#comment_score_display').text('-'); // Placeholder
    $('#comment_nav_display').text('Trace -/-');
    $('#prev_comment_btn').prop('disabled', true);
    $('#next_comment_btn').prop('disabled', true);
    $('#upvote_btn').prop('disabled', true);
    $('#downvote_btn').prop('disabled', true);

    // Update distance display for the newly loaded task/test pair
    updateDistanceDisplay();
}


function display_task_name(taskIdentifier) {
    let displayName = taskIdentifier || "Untitled Task";

    let indexText = "";
    if (CURRENT_TASK_INDEX !== -1 && LOADED_TASK_LIST.length > 0) {
        indexText = ` (${CURRENT_TASK_INDEX + 1}/${LOADED_TASK_LIST.length})`;
    }

    // Display format: "Task name: [ID/Name] (Index/Total)"
    $('#task_name').html(`Task name:&nbsp;&nbsp;&nbsp;&nbsp;${displayName}${indexText}`);
}

function updateListNavigationUI() {
    if (CURRENT_TASK_INDEX !== -1 && LOADED_TASK_LIST.length > 0) {
        $('#list_navigation').show();
        $('#goto_id_controls').show(); // Show Go To ID when list is loaded
        $('#task_index_display').text(`Task ${CURRENT_TASK_INDEX + 1}/${LOADED_TASK_LIST.length}`);
        $('#prev_task_btn').prop('disabled', CURRENT_TASK_INDEX === 0);
        $('#next_task_btn').prop('disabled', CURRENT_TASK_INDEX === LOADED_TASK_LIST.length - 1);
    } else {
        $('#list_navigation').hide();
        $('#goto_id_controls').hide(); // Hide Go To ID if no list
    }
}

// --- Trace Functions --- // Renamed section

function displayTraces() { // Renamed function
    if (CURRENT_TASK_INDEX < 0 || !LOADED_TASK_LIST[CURRENT_TASK_INDEX]) {
        $('#comment_section').hide(); // Hide if no task loaded
        return;
    }

    const currentTask = LOADED_TASK_LIST[CURRENT_TASK_INDEX];
    // Ensure 'comments' array exists (it should have been initialized in loadDataset)
    if (!currentTask.comments) {
        currentTask.comments = [];
    }

    // Sort traces by score descending (highest first)
    const sortedTraces = [...currentTask.comments].sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        // Optional: tie-break by timestamp (newest first)
        // return (b.timestamp || 0) - (a.timestamp || 0);
        return 0; // Default: maintain original order on tie
    });

    const totalTraces = sortedTraces.length;

    if (totalTraces === 0) {
        $('#comment_display_area').text('No reasoning traces added yet.');
        $('#comment_score_display').text('0');
        $('#comment_nav_display').text('Trace 0/0');
        $('#prev_comment_btn').prop('disabled', true);
        $('#next_comment_btn').prop('disabled', true);
        $('#upvote_btn').prop('disabled', true);
        $('#downvote_btn').prop('disabled', true);
    } else {
        // Ensure current trace index is valid
        if (CURRENT_TRACE_INDEX >= totalTraces) {
            CURRENT_TRACE_INDEX = totalTraces - 1;
        }
        if (CURRENT_TRACE_INDEX < 0) {
            CURRENT_TRACE_INDEX = 0;
        }

        const traceToShow = sortedTraces[CURRENT_TRACE_INDEX];
        // Display trace text, score, and potentially username
        let traceHtml = $('<div>').text(traceToShow.text || '').html(); // Basic text display, escape HTML
        if (traceToShow.username) {
             traceHtml += `<br><span style="font-size: 0.8em; color: #555;"> - ${$('<div>').text(traceToShow.username).html()}</span>`; // Display username safely
        }
        $('#comment_display_area').html(traceHtml); // Use .html() to render the break and span
        $('#comment_score_display').text(traceToShow.score || 0);
        $('#comment_nav_display').text(`Trace ${CURRENT_TRACE_INDEX + 1}/${totalTraces}`);

        // Enable/disable navigation buttons
        $('#prev_comment_btn').prop('disabled', CURRENT_TRACE_INDEX === 0);
        $('#next_comment_btn').prop('disabled', CURRENT_TRACE_INDEX === totalTraces - 1);
        // Enable voting buttons
        $('#upvote_btn').prop('disabled', false);
        $('#downvote_btn').prop('disabled', false);
    }

    $('#comment_section').show(); // Make sure section is visible
}

function previousTrace() { // Renamed function
    if (CURRENT_TASK_INDEX < 0) return;
    if (CURRENT_TRACE_INDEX > 0) {
        CURRENT_TRACE_INDEX--;
        displayTraces(); // Call renamed function
    }
}

function nextTrace() { // Renamed function
    if (CURRENT_TASK_INDEX < 0) return;
    const currentTask = LOADED_TASK_LIST[CURRENT_TASK_INDEX];
    const totalTraces = currentTask.comments ? currentTask.comments.length : 0; // Still uses 'comments' array

    if (CURRENT_TRACE_INDEX < totalTraces - 1) {
        CURRENT_TRACE_INDEX++;
        displayTraces(); // Call renamed function
    }
}

function upvoteTrace() { // Renamed function
    voteOnTrace(1);
}

function downvoteTrace() { // Renamed function
    voteOnTrace(-1);
}

function voteOnTrace(voteChange) { // Renamed function
     if (CURRENT_TASK_INDEX < 0 || !LOADED_TASK_LIST[CURRENT_TASK_INDEX]) return;
    const currentTask = LOADED_TASK_LIST[CURRENT_TASK_INDEX];
    if (!currentTask.comments || currentTask.comments.length === 0) return;

    // Get the currently displayed trace based on the sorted order.
    const sortedTraces = [...currentTask.comments].sort((a, b) => b.score - a.score);
    if (CURRENT_TRACE_INDEX >= sortedTraces.length) return; // Index out of bounds

    const displayedTraceObject = sortedTraces[CURRENT_TRACE_INDEX];

    // Find this trace in the original task.comments array using its unique ID
    // This relies on the server sending back a unique 'trace_id'
    const originalTrace = currentTask.comments.find(c => c.trace_id === displayedTraceObject.trace_id);

    if (originalTrace) {
        // Emit vote event to server instead of changing locally
        if (socket && socket.connected) {
            console.log(`Emitting vote_trace: trace_id=${originalTrace.trace_id}, username=${USERNAME}, vote=${voteChange}`);
            socket.emit('vote_trace', {
                trace_id: originalTrace.trace_id,
                username: USERNAME,
                vote: voteChange
            });
            // Optionally disable buttons temporarily until update received
            $('#upvote_btn').prop('disabled', true);
            $('#downvote_btn').prop('disabled', true);
        } else {
            errorMsg("Cannot vote: Not connected to real-time server.");
        }
    } else {
        // This case might happen if the trace_id isn't set correctly yet
        console.error("Could not find the original trace to vote on. Displayed Object:", displayedTraceObject);
        errorMsg("Error applying vote: Trace not found locally (might be missing ID).");
    }
}


function addTrace() { // Renamed function
    // Username is now validated before loading a dataset, so this check is redundant here.
    // if (!USERNAME || USERNAME === "Anonymous") { ... }

    if (CURRENT_TASK_INDEX < 0 || !LOADED_TASK_LIST[CURRENT_TASK_INDEX]) {
        errorMsg("No task loaded to add a reasoning trace to.");
        return;
    }
    const traceText = $('#new_comment_text').val().trim(); // Use the same textarea ID for now
    if (!traceText) {
        errorMsg("Reasoning trace cannot be empty.");
        return;
    }

    const currentTask = LOADED_TASK_LIST[CURRENT_TASK_INDEX];
    const taskId = currentTask.id;

    if (!taskId) {
        errorMsg("Cannot add trace: Current task is missing an ID.");
        return;
    }

    // Emit add_trace event to server
    if (socket && socket.connected) {
         console.log(`Emitting add_trace: task_id=${taskId}, username=${USERNAME}, text=${traceText}`);
         socket.emit('add_trace', {
             task_id: taskId,
             username: USERNAME,
             text: traceText
         });
         $('#new_comment_text').val(''); // Clear textarea immediately
         infoMsg("Submitting reasoning trace..."); // Give feedback
    } else {
         errorMsg("Cannot add trace: Not connected to real-time server.");
    }
    // Don't add locally or refresh display, wait for broadcast
}

function downloadData() {
    if (!LOADED_TASK_LIST || LOADED_TASK_LIST.length === 0) {
        errorMsg("No dataset loaded to download.");
        return;
    }

    try {
        // Use a deep copy to avoid modifying the original data if needed later,
        const dataToDownload = JSON.parse(JSON.stringify(LOADED_TASK_LIST));

        // Convert the data (which includes traces) to a JSON string
        const jsonString = JSON.stringify(dataToDownload, null, 2); // Use indentation for readability

        // Create a Blob object
        const blob = new Blob([jsonString], { type: 'application/json' });

        // Create a temporary download link
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);

        // Set the filename for the download
        const filename = `${CURRENT_DATASET_NAME || 'dataset'}_with_traces.json`; // Update filename
        link.download = filename;

        // Programmatically click the link to trigger the download
        document.body.appendChild(link); // Required for Firefox
        link.click();

        // Clean up the temporary link
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href); // Free up memory

        infoMsg(`Dataset with traces ('${filename}') download initiated.`); // Update message

    } catch (e) {
        console.error("Error preparing data for download:", e);
        errorMsg("Failed to prepare data for download.");
    }
}


// --- End Trace Functions --- // Renamed section


// Removed loadTaskFromFile function

function loadDataset(datasetName) {
    // --- Username Check ---
    if (!USERNAME || USERNAME === "Anonymous") {
        $('#username_error').show(); // Show the error message near the username input
        $('#username_input').focus(); // Focus the input
        // Do not proceed with loading
        return;
    } else {
        $('#username_error').hide(); // Hide error if username is provided
    }
    // --- End Username Check ---

    // Prevent reloading the same dataset unnecessarily
    if (CURRENT_DATASET_NAME === datasetName && LOADED_TASK_LIST.length > 0) {
        infoMsg(`Dataset '${datasetName}' is already loaded.`);
        return; // Already loaded, no need to proceed
    }

    console.log(`Attempting to load dataset: ${datasetName} with username: ${USERNAME}`); // Add log
    resetTask(); // Full reset before loading new dataset
    CURRENT_DATASET_NAME = datasetName; // Set dataset name early for potential error messages
    // Correct the path: Go up one level from 'apps' to the root, then into 'data'
    // const filename = `../data/${datasetName}.json`; // Path for direct file access (CORS issue)
    const serverRoute = `/data/${datasetName}.json`; // Path for Flask server route

    infoMsg(`Loading dataset '${datasetName}'...`); // Clear previous messages
    errorMsg(''); // Clear previous error messages
    $('#loaded_dataset_display').text(`Loading ${datasetName}...`);
    console.log(`Fetching base data from ${serverRoute}...`); // Use server route

    // Use Flask server route instead of direct file access
    $.ajax({
        url: serverRoute, // Use the server route
        dataType: 'json',
        success: function(data) {
            console.log(`Successfully fetched base data for ${datasetName}. Processing...`);
            if (!Array.isArray(data)) {
                console.error(`Data from ${serverRoute} is not an array.`);
                errorMsg(`Error: Base dataset file '${datasetName}' does not contain a valid JSON list.`);
                resetTask();
                $('#loaded_dataset_display').text(`Failed: Invalid format`);
                // Modal removed, don't show/hide workspace, stay on welcome screen
                return;
            }
            if (data.length === 0) {
                console.error(`Data from ${serverRoute} is an empty array.`);
                errorMsg(`Error: Base dataset '${datasetName}' is empty.`);
                resetTask();
                $('#loaded_dataset_display').text(`Failed: Empty dataset`);
                // Modal removed, don't show/hide workspace, stay on welcome screen
                return;
            }

            console.log(`Base dataset ${datasetName} has ${data.length} tasks. Building ID map...`);
            LOADED_TASK_LIST = data; // Store the base data
            CURRENT_TASK_INDEX = 0; // Start at the first task

            // Build the ID map and ensure 'comments' array exists (will be populated by WebSocket)
            TASK_ID_MAP = {};
            LOADED_TASK_LIST.forEach((task, index) => {
                task.comments = []; // Initialize comments as empty, wait for server data
                if (task.id) {
                    TASK_ID_MAP[task.id] = index;
                } else {
                    console.warn(`Task at index ${index} in ${datasetName}.json is missing an 'id' field.`);
                }
            });
            console.log(`ID map built and comments array initialized for ${datasetName}. Loading first task...`);

            // Load the first task's base data into the UI
            // --- Hide Welcome, Show Main Content ---
            $('#welcome_screen').hide();
            $('#demonstration_examples_view').show();
            $('#evaluation_view').show(); // Show the parent container for evaluation sections
            // Note: comment_section visibility is handled within loadSingleTask/displayTraces
            // --- End Hide Welcome ---

            // Load the first task's base data into the UI
            loadSingleTask(LOADED_TASK_LIST[0], LOADED_TASK_LIST[0].id || `${datasetName} Task 1`);
            infoMsg(`Successfully loaded base data for ${LOADED_TASK_LIST.length} tasks from '${datasetName}' dataset.`);
            $('#loaded_dataset_display').text(`Loaded: ${datasetName}`); // Update status on welcome screen (though it's now hidden)
            console.log(`Hid welcome screen and showed main content for ${datasetName}.`);

            // WebSocket connection should already be established by $(document).ready
            // loadSingleTask will emit 'request_traces'
        },
        error: function(jqXHR, textStatus, errorThrown) {
            console.error(`Failed to load base data ${serverRoute}. Status: ${textStatus}, Error: ${errorThrown}`, jqXHR);
            errorMsg(`Failed to load base dataset '${datasetName}'. Check server logs. Status: ${textStatus}.`);
            resetTask();
            $('#loaded_dataset_display').text(`Failed to load ${datasetName}`);
            // Don't hide workspace or show modal, stay on welcome screen on error
        }
    });
}


function randomTask() {
    // Only pick from the currently loaded list
    if (LOADED_TASK_LIST.length > 0) {
        let randomIndex = Math.floor(Math.random() * LOADED_TASK_LIST.length);
        // Avoid picking the same task consecutively if possible
        if (LOADED_TASK_LIST.length > 1 && randomIndex === CURRENT_TASK_INDEX) {
            randomIndex = (randomIndex + 1) % LOADED_TASK_LIST.length;
        }
        CURRENT_TASK_INDEX = randomIndex;
        // Use task ID if available, otherwise construct a name
        let taskIdentifier = LOADED_TASK_LIST[CURRENT_TASK_INDEX]?.id || `${CURRENT_DATASET_NAME} Task ${CURRENT_TASK_INDEX + 1}`;
        loadSingleTask(LOADED_TASK_LIST[CURRENT_TASK_INDEX], taskIdentifier);
        infoMsg(`Loaded random task ${CURRENT_TASK_INDEX + 1}/${LOADED_TASK_LIST.length} from '${CURRENT_DATASET_NAME}' dataset.`);
    } else {
        // No dataset loaded, show error or prompt
        errorMsg("Please load a dataset first before selecting a random task.");
    }
}

function previousTask() {
    if (CURRENT_TASK_INDEX > 0) {
        CURRENT_TASK_INDEX--;
        let taskIdentifier = LOADED_TASK_LIST[CURRENT_TASK_INDEX]?.id || `${CURRENT_DATASET_NAME} Task ${CURRENT_TASK_INDEX + 1}`;
        loadSingleTask(LOADED_TASK_LIST[CURRENT_TASK_INDEX], taskIdentifier);
    }
}

function nextTask() {
    if (CURRENT_TASK_INDEX < LOADED_TASK_LIST.length - 1) {
        CURRENT_TASK_INDEX++;
        let taskIdentifier = LOADED_TASK_LIST[CURRENT_TASK_INDEX]?.id || `${CURRENT_DATASET_NAME} Task ${CURRENT_TASK_INDEX + 1}`;
        loadSingleTask(LOADED_TASK_LIST[CURRENT_TASK_INDEX], taskIdentifier);
    }
}

function gotoTaskById() {
    const taskId = $('#task_id_input').val().trim();
    if (!taskId) {
        errorMsg("Please enter a Task ID.");
        return;
    }

    if (TASK_ID_MAP.hasOwnProperty(taskId)) {
        const targetIndex = TASK_ID_MAP[taskId];
        if (targetIndex !== CURRENT_TASK_INDEX) {
            CURRENT_TASK_INDEX = targetIndex;
            let taskIdentifier = LOADED_TASK_LIST[CURRENT_TASK_INDEX]?.id; // Should always have ID here
            loadSingleTask(LOADED_TASK_LIST[CURRENT_TASK_INDEX], taskIdentifier);
            infoMsg(`Navigated to task ID: ${taskId}`);
            $('#task_id_input').val(''); // Clear input on success
        } else {
            infoMsg(`Already viewing task ID: ${taskId}`);
        }
    } else {
        errorMsg(`Task ID '${taskId}' not found in the current '${CURRENT_DATASET_NAME}' dataset.`);
    }
}


function nextTestInput() {
    if (TEST_PAIRS.length <= CURRENT_TEST_PAIR_INDEX + 1) {
        errorMsg('No next test input.') // Removed suggestion to pick another file
        return
    }
    CURRENT_TEST_PAIR_INDEX += 1;
    values = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]['input'];
    CURRENT_INPUT_GRID = convertSerializedGridToGridObject(values)
    fillTestInput(CURRENT_INPUT_GRID);
    $('#current_test_input_id_display').html(CURRENT_TEST_PAIR_INDEX + 1);
    $('#total_test_input_count_display').html(TEST_PAIRS.length);
    updateDistanceDisplay(); // Update distance for the new test input
}

function submitSolution() {
    syncFromEditionGridToDataGrid();
    reference_output = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]['output'];
    submitted_output = CURRENT_OUTPUT_GRID.grid;
    // Compare dimensions first
    if (reference_output.length !== submitted_output.length || (reference_output.length > 0 && reference_output[0].length !== submitted_output[0].length)) {
         errorMsg('Wrong solution dimensions.');
         return;
    }
    for (var i = 0; i < reference_output.length; i++){
        ref_row = reference_output[i];
        for (var j = 0; j < ref_row.length; j++){
            if (ref_row[j] != submitted_output[i][j]) {
                errorMsg('Wrong solution.');
                return
            }
        }
    }
    infoMsg('Correct solution!');
}

function fillTestInput(inputGrid) {
    jqInputGrid = $('#evaluation_input');
    fillJqGridWithData(jqInputGrid, inputGrid);
    // Get the actual container dimensions after filling data
    const containerHeight = jqInputGrid.height();
    const containerWidth = jqInputGrid.width();
    fitCellsToContainer(jqInputGrid, inputGrid.height, inputGrid.width, containerHeight, containerWidth);
}

function copyToOutput() {
    syncFromEditionGridToDataGrid();
    CURRENT_OUTPUT_GRID = convertSerializedGridToGridObject(CURRENT_INPUT_GRID.grid);
    syncFromDataGridToEditionGrid();
    $('#output_grid_size').val(CURRENT_OUTPUT_GRID.height + 'x' + CURRENT_OUTPUT_GRID.width);
}

function initializeSelectable() {
    try {
        $('.selectable_grid').selectable('destroy');
    }
    catch (e) {
    }
    toolMode = $('input[name=tool_switching]:checked').val();
    if (toolMode == 'select') {
        infoMsg('Select some cells and click on a color to fill in, or press C to copy');
        $('.selectable_grid').selectable(
            {
                autoRefresh: false,
                filter: '> .row > .cell',
                start: function(event, ui) {
                    $('.ui-selected').each(function(i, e) {
                        $(e).removeClass('ui-selected');
                    });
                }
            }
        );
    }
}


// --- Hamming Distance Calculation and Display ---

function calculateHammingDistance(grid1, grid2) {
    // Check if grids are valid arrays
    if (!Array.isArray(grid1) || !Array.isArray(grid2)) return Infinity;

    const h1 = grid1.length;
    const w1 = h1 > 0 ? grid1[0].length : 0;
    const h2 = grid2.length;
    const w2 = h2 > 0 ? grid2[0].length : 0;

    // Check for dimension mismatch or empty grids
    if (h1 !== h2 || w1 !== w2 || h1 === 0 || w1 === 0) {
        return Infinity;
    }

    let diff = 0;
    const totalPixels = h1 * w1;

    for (let i = 0; i < h1; i++) {
        // Ensure rows are arrays
        if (!Array.isArray(grid1[i]) || !Array.isArray(grid2[i])) return Infinity;
        for (let j = 0; j < w1; j++) {
            if (grid1[i][j] !== grid2[i][j]) {
                diff++;
            }
        }
    }

    return diff / totalPixels;
}

function updateDistanceDisplay() {
    const distanceSpan = $('#distance_value_display');
    // Check if we have valid test pairs and a valid index
    if (!TEST_PAIRS || CURRENT_TEST_PAIR_INDEX < 0 || CURRENT_TEST_PAIR_INDEX >= TEST_PAIRS.length || !TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]['output']) {
        distanceSpan.text('N/A'); // Not Applicable if no solution available
        return;
    }

    const correctOutputGrid = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]['output'];
    // Ensure CURRENT_OUTPUT_GRID reflects the latest state of the UI grid
    syncFromEditionGridToDataGrid();
    const userOutputGrid = CURRENT_OUTPUT_GRID.grid;

    const distance = calculateHammingDistance(userOutputGrid, correctOutputGrid);

    if (distance === Infinity) {
        distanceSpan.text('Infinity (Size Mismatch)');
    } else {
        // Format to 2 decimal places for readability
        distanceSpan.text(distance.toFixed(2));
    }
}


function toggleDistanceDisplay() {
    const isChecked = $('#show_distance_toggle').prop('checked');
    const controlsDiv = $('#distance_display_controls');
    if (isChecked) {
        controlsDiv.removeClass('distance-hidden');
        updateDistanceDisplay(); // Update display immediately when shown
    } else {
        controlsDiv.addClass('distance-hidden');
    }
}

// --- WebSocket Connection & Event Handlers ---

function connectWebSocket() {
    // Connect to the Socket.IO server (adjust URL if server runs elsewhere)
    console.log("Attempting to connect WebSocket...");
    if (socket && socket.connected) {
        console.log("WebSocket already connected.");
        return;
    }
    // Connect to the server hosting the page, default port 5000
    socket = io(`http://${window.location.hostname}:5000`);

    socket.on('connect', () => {
        console.log('WebSocket connected successfully. SID:', socket.id);
        infoMsg('Connected to real-time server.');
    });

    socket.on('disconnect', (reason) => {
        console.log('WebSocket disconnected:', reason);
        errorMsg('Disconnected from real-time server. Refresh may be needed.');
    });

    socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error);
        errorMsg('Failed to connect to real-time server.');
    });

    socket.on('connection_ack', (data) => {
        console.log('Server Acknowledged Connection:', data.message);
    });

    socket.on('initial_traces', (data) => {
        console.log('Received initial_traces for task', data.task_id, ':', data.traces);
        const currentTask = LOADED_TASK_LIST[CURRENT_TASK_INDEX];
        // Ensure this message is for the currently viewed task
        if (currentTask && currentTask.id === data.task_id) {
            // Replace local comments with server data
            currentTask.comments = Array.isArray(data.traces) ? data.traces : [];
            CURRENT_TRACE_INDEX = 0; // Reset view to the first trace
            displayTraces(); // Update the display
        } else {
            console.log("Received initial_traces for a non-current task, ignoring for now.");
        }
    });

    socket.on('new_trace', (newTrace) => {
        console.log('Received new_trace:', newTrace);
        const currentTask = LOADED_TASK_LIST[CURRENT_TASK_INDEX];
        // Find the task in memory to add the trace to
        const targetTask = LOADED_TASK_LIST.find(task => task.id === newTrace.task_id);
        if (targetTask) {
             if (!targetTask.comments) targetTask.comments = [];
             // Avoid adding duplicates
             if (!targetTask.comments.some(c => c.trace_id === newTrace.trace_id)) {
                 targetTask.comments.push(newTrace);
                 console.log(`Added new trace ${newTrace.trace_id} to task ${newTrace.task_id} locally.`);
                 // If it's for the currently viewed task, refresh display
                 if (currentTask && currentTask.id === newTrace.task_id) {
                     CURRENT_TRACE_INDEX = 0; // Go to first trace after adding
                     displayTraces();
                 }
             } else {
                 console.log(`Duplicate new_trace message received for ${newTrace.trace_id}, ignoring.`);
             }
        } else {
            console.warn(`Received new_trace for unknown task_id ${newTrace.task_id}`);
        }
    });

    socket.on('trace_updated', (updatedInfo) => {
        console.log('Received trace_updated:', updatedInfo);
        const currentTask = LOADED_TASK_LIST[CURRENT_TASK_INDEX];
        // Find the task and trace in memory and update score
        const targetTask = LOADED_TASK_LIST.find(task => task.id === updatedInfo.task_id);
        if (targetTask && targetTask.comments) {
            const targetTrace = targetTask.comments.find(c => c.trace_id === updatedInfo.trace_id);
            if (targetTrace) {
                targetTrace.score = updatedInfo.score;
                // Optionally update voters if needed: targetTrace.voters = updatedInfo.voters;
                console.log(`Updated score for trace ${updatedInfo.trace_id} to ${updatedInfo.score} locally.`);
                // If it's for the currently viewed task, refresh display
                if (currentTask && currentTask.id === updatedInfo.task_id) {
                    displayTraces();
                }
            } else {
                 console.warn(`Received trace_updated for unknown trace_id ${updatedInfo.trace_id}`);
            }
        } else {
             console.warn(`Received trace_updated for unknown task_id ${updatedInfo.task_id}`);
        }
        // Re-enable voting buttons
        $('#upvote_btn').prop('disabled', false);
        $('#downvote_btn').prop('disabled', false);
    });

     socket.on('trace_error', (error) => {
        // Handle errors sent from the server related to traces/votes
        console.error('Server Trace Error:', error.message);
        errorMsg(`Server error: ${error.message}`);
    });
}


// --- End WebSocket ---


// Initial event binding.

$(document).ready(function () {

    // --- Initial UI State ---
    // Show only the welcome screen initially
    $('#welcome_screen').show();
    $('#demonstration_examples_view').hide();
    $('#evaluation_view').hide();
    $('#comment_section').hide(); // Ensure comment section is also hidden initially
    // --- End Initial UI State ---

    // Initialize WebSocket connection on page load
    connectWebSocket();

    // Update username variable when input changes, hide error on input
    $('#username_input').on('input change', function() { // Trigger on input and change
        let name = $(this).val().trim();
        USERNAME = name || "Anonymous"; // Use 'Anonymous' if empty or only whitespace
        if (name) {
            $('#username_error').hide(); // Hide error message when user starts typing
        }
        console.log("Username set to:", USERNAME);
    });

    // Set initial distance display visibility based on checkbox state
    toggleDistanceDisplay();

    $('#symbol_picker').find('.symbol_preview').click(function(event) {
        symbol_preview = $(event.target);
        $('#symbol_picker').find('.symbol_preview').each(function(i, preview) {
            $(preview).removeClass('selected-symbol-preview');
        })
        symbol_preview.addClass('selected-symbol-preview');

        toolMode = $('input[name=tool_switching]:checked').val();
        if (toolMode == 'select') {
            $('.edition_grid').find('.ui-selected').each(function(i, cell) {
                symbol = getSelectedSymbol();
                setCellSymbol($(cell), symbol);
            });
        }
    });

    $('.edition_grid').each(function(i, jqGrid) {
        setUpEditionGridListeners($(jqGrid));
    });

    // Removed event listeners for '.load_task'

    $('input[type=radio][name=tool_switching]').change(function() {
        initializeSelectable();
    });

    $('input[type=text][name=size]').on('keydown', function(event) {
        // Trigger resize on Enter key
        if (event.keyCode == 13) {
            resizeOutputGrid();
        }
    });

    // Add event listener for Enter key in the Go To ID input
    $('#task_id_input').on('keydown', function(event) {
        if (event.keyCode == 13) { // 13 is the Enter key
            gotoTaskById();
        }
    });


    $('body').keydown(function(event) {
        // Ignore keydown events if focused in an input field (like Go To ID or username)
        if ($(event.target).is('input, textarea')) {
            return;
        }

        // Copy and paste functionality.
        if (event.which == 67) { // Key 'C'
            // Press C

            selected = $('.ui-selected');
            if (selected.length == 0) {
                return;
            }

            COPY_PASTE_DATA = [];
            for (var i = 0; i < selected.length; i ++) {
                x = parseInt($(selected[i]).attr('x'));
                y = parseInt($(selected[i]).attr('y'));
                symbol = parseInt($(selected[i]).attr('symbol'));
                COPY_PASTE_DATA.push([x, y, symbol]);
            }
            infoMsg('Cells copied! Select a target cell and press V to paste at location.');

        }
        if (event.which == 86) { // Key 'V'
            // Press V (Paste)
            if (COPY_PASTE_DATA.length == 0) {
                errorMsg('No data to paste. Press C on selected cells to copy.');
                return;
            }
            selected = $('.edition_grid').find('.ui-selected');
            if (selected.length == 0) {
                errorMsg('Select a target cell on the output grid.');
                return;
            }

            jqGrid = $(selected.parent().parent()[0]);

            if (selected.length == 1) {
                targetx = parseInt(selected.attr('x'));
                targety = parseInt(selected.attr('y'));

                xs = new Array();
                ys = new Array();
                symbols = new Array();

                for (var i = 0; i < COPY_PASTE_DATA.length; i ++) {
                    xs.push(COPY_PASTE_DATA[i][0]);
                    ys.push(COPY_PASTE_DATA[i][1]);
                    symbols.push(COPY_PASTE_DATA[i][2]);
                }

                minx = Math.min(...xs);
                miny = Math.min(...ys);
                for (var i = 0; i < xs.length; i ++) {
                    x = xs[i];
                    y = ys[i];
                    symbol = symbols[i];
                    newx = x - minx + targetx;
                    newy = y - miny + targety;
                    res = jqGrid.find('[x="' + newx + '"][y="' + newy + '"] ');
                    if (res.length == 1) {
                        cell = $(res[0]);
                        setCellSymbol(cell, symbol);
                    }
                }
                // Update distance after paste
                updateDistanceDisplay();
            } else {
                errorMsg('Can only paste at a specific location; only select *one* cell as paste destination.');
            }
        }
    });
});
