<?php
// api/services/rate.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

$data = json_decode(file_get_contents("php://input"), true);

if (!$data) {
    sendResponse(false, null, 'Invalid JSON data', 400);
}

$required_fields = ['service_id', 'rating'];
$missing_fields = validateRequired($data, $required_fields);

if (!empty($missing_fields)) {
    sendResponse(false, null, 'Missing required fields: ' . implode(', ', $missing_fields), 400);
}

$service_id = (int)$data['service_id'];
$rating = (int)$data['rating'];
$feedback = isset($data['feedback']) ? sanitizeInput($data['feedback']) : null;

if ($rating < 1 || $rating > 5) {
    sendResponse(false, null, 'Rating must be between 1 and 5', 400);
}

try {
    // Check if user can rate this service
    $check_query = "SELECT t.task_id 
                    FROM tasks t
                    JOIN posts p ON t.post_id = p.post_id
                    WHERE t.task_id = :service_id AND p.user_id = :user_id AND t.task_status = 'completed'";
    $check_stmt = $db->prepare($check_query);
    $check_stmt->bindParam(':service_id', $service_id);
    $check_stmt->bindParam(':user_id', $user['user_id']);
    $check_stmt->execute();
    
    if ($check_stmt->rowCount() === 0) {
        sendResponse(false, null, 'Service not found or cannot be rated', 404);
    }
    
    // Check if already rated
    $existing_query = "SELECT feedback_id FROM task_feedback WHERE task_id = :service_id";
    $existing_stmt = $db->prepare($existing_query);
    $existing_stmt->bindParam(':service_id', $service_id);
    $existing_stmt->execute();
    
    if ($existing_stmt->rowCount() > 0) {
        // Update existing rating
        $query = "UPDATE task_feedback SET consumer_rating = :rating, consumer_feedback = :feedback, updated_at = CURRENT_TIMESTAMP WHERE task_id = :service_id";
    } else {
        // Insert new rating
        $query = "INSERT INTO task_feedback (task_id, consumer_rating, consumer_feedback) VALUES (:service_id, :rating, :feedback)";
    }
    
    $stmt = $db->prepare($query);
    $stmt->bindParam(':service_id', $service_id);
    $stmt->bindParam(':rating', $rating);
    $stmt->bindParam(':feedback', $feedback);
    
    if ($stmt->execute()) {
        sendResponse(true, null, 'Rating submitted successfully');
    } else {
        sendResponse(false, null, 'Failed to submit rating', 500);
    }
    
} catch(PDOException $exception) {
    error_log("Rate service error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to submit rating', 500);
}
?>