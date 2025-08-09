<?php
require_once 'config.php';

session_start();

$conn = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);

switch ($method) {
    case 'POST':
        if (isset($input['action'])) {
            switch ($input['action']) {
                case 'website_feedback':
                    submitWebsiteFeedback($conn, $input);
                    break;
                case 'task_feedback':
                    requireAuth();
                    submitTaskFeedback($conn, $input, $_SESSION['user_id']);
                    break;
                case 'contact':
                    submitContact($conn, $input);
                    break;
                default:
                    sendResponse(false, 'Invalid action');
            }
        }
        break;
    case 'GET':
        if (isset($_GET['action'])) {
            switch ($_GET['action']) {
                case 'task_feedback':
                    requireAuth();
                    getTaskFeedback($conn, $_GET['task_id']);
                    break;
                default:
                    sendResponse(false, 'Invalid action');
            }
        }
        break;
    default:
        sendResponse(false, 'Method not allowed');
}

function requireAuth()
{
    if (!isset($_SESSION['logged_in']) || $_SESSION['logged_in'] !== true) {
        sendResponse(false, 'Authentication required');
    }
}

function submitWebsiteFeedback($conn, $data)
{
    $rating = (int) $data['rating'];
    $feedback = sanitizeInput($data['feedback']);
    $user_id = isset($_SESSION['user_id']) ? $_SESSION['user_id'] : null;

    if ($rating < 1 || $rating > 5) {
        sendResponse(false, 'Rating must be between 1 and 5');
    }

    if (empty($feedback)) {
        sendResponse(false, 'Feedback is required');
    }

    $stmt = $conn->prepare("INSERT INTO website_feedback (rating, feedback, user_id) VALUES (?, ?, ?)");
    $stmt->bind_param("isi", $rating, $feedback, $user_id);

    if ($stmt->execute()) {
        sendResponse(true, 'Website feedback submitted successfully');
    } else {
        sendResponse(false, 'Failed to submit website feedback');
    }
}

function submitTaskFeedback($conn, $data, $user_id)
{
    $task_id = (int) $data['task_id'];
    $consumer_rating = isset($data['consumer_rating']) ? (int) $data['consumer_rating'] : null;
    $consumer_feedback = isset($data['consumer_feedback']) ? sanitizeInput($data['consumer_feedback']) : '';
    $technician_rating = isset($data['technician_rating']) ? (int) $data['technician_rating'] : null;
    $technician_feedback = isset($data['technician_feedback']) ? sanitizeInput($data['technician_feedback']) : '';

    if (empty($task_id)) {
        sendResponse(false, 'Task ID is required');
    }

    // Verify user has access to this task
    $stmt = $conn->prepare("
        SELECT t.task_id, p.user_id as post_owner, tech.user_id as tech_user_id 
        FROM Tasks t 
        JOIN Posts p ON t.post_id = p.post_id 
        JOIN technician tech ON t.technician_id = tech.technician_id 
        WHERE t.task_id = ?
    ");
    $stmt->bind_param("i", $task_id);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows === 0) {
        sendResponse(false, 'Task not found');
    }

    $task = $result->fetch_assoc();
    $is_consumer = ($task['post_owner'] == $user_id);
    $is_technician = ($task['tech_user_id'] == $user_id);

    if (!$is_consumer && !$is_technician) {
        sendResponse(false, 'Access denied');
    }

    // Check if feedback already exists
    $stmt = $conn->prepare("SELECT feedback_id FROM task_feedback WHERE task_id = ?");
    $stmt->bind_param("i", $task_id);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows > 0) {
        // Update existing feedback
        $feedback_id = $result->fetch_assoc()['feedback_id'];

        if ($is_consumer) {
            $stmt = $conn->prepare("UPDATE task_feedback SET consumer_rating = ?, consumer_feedback = ? WHERE feedback_id = ?");
            $stmt->bind_param("isi", $consumer_rating, $consumer_feedback, $feedback_id);
        } else {
            $stmt = $conn->prepare("UPDATE task_feedback SET technician_rating = ?, technician_feedback = ? WHERE feedback_id = ?");
            $stmt->bind_param("isi", $technician_rating, $technician_feedback, $feedback_id);
        }
    } else {
        // Create new feedback
        $stmt = $conn->prepare("INSERT INTO task_feedback (consumer_rating, consumer_feedback, technician_rating, technician_feedback, task_id) VALUES (?, ?, ?, ?, ?)");
        $stmt->bind_param("isisi", $consumer_rating, $consumer_feedback, $technician_rating, $technician_feedback, $task_id);
    }

    if ($stmt->execute()) {
        sendResponse(true, 'Task feedback submitted successfully');
    } else {
        sendResponse(false, 'Failed to submit task feedback');
    }
}

function getTaskFeedback($conn, $task_id)
{
    if (empty($task_id)) {
        sendResponse(false, 'Task ID is required');
    }

    $stmt = $conn->prepare("SELECT * FROM task_feedback WHERE task_id = ?");
    $stmt->bind_param("i", $task_id);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows > 0) {
        $feedback = $result->fetch_assoc();
        sendResponse(true, 'Task feedback retrieved successfully', $feedback);
    } else {
        sendResponse(true, 'No feedback found for this task', null);
    }
}

function submitContact($conn, $data)
{
    $name = sanitizeInput($data['name']);
    $email = sanitizeInput($data['email']);
    $phone = sanitizeInput($data['phone']);
    $address = sanitizeInput($data['address']);
    $message = sanitizeInput($data['message']);

    if (empty($name) || empty($email) || empty($message)) {
        sendResponse(false, 'Name, email, and message are required');
    }

    $stmt = $conn->prepare("INSERT INTO contact (Name, email, phone_no, address, message) VALUES (?, ?, ?, ?, ?)");
    $stmt->bind_param("sssss", $name, $email, $phone, $address, $message);

    if ($stmt->execute()) {
        sendResponse(true, 'Contact message submitted successfully');
    } else {
        sendResponse(false, 'Failed to submit contact message');
    }
}
?>