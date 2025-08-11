<?php
// api/bids/submit.php
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

$required_fields = ['post_id', 'price'];
$missing_fields = validateRequired($data, $required_fields);

if (!empty($missing_fields)) {
    sendResponse(false, null, 'Missing required fields: ' . implode(', ', $missing_fields), 400);
}

$post_id = (int)$data['post_id'];
$price = (float)$data['price'];

if ($price <= 0) {
    sendResponse(false, null, 'Price must be greater than 0', 400);
}

try {
    // Check if user is a verified technician
    $tech_query = "SELECT technician_id FROM technician WHERE user_id = :user_id AND status = 'approved'";
    $tech_stmt = $db->prepare($tech_query);
    $tech_stmt->bindParam(':user_id', $user['user_id']);
    $tech_stmt->execute();
    
    if ($tech_stmt->rowCount() === 0) {
        sendResponse(false, null, 'You must be a verified technician to submit bids', 403);
    }
    
    $technician = $tech_stmt->fetch(PDO::FETCH_ASSOC);
    $technician_id = $technician['technician_id'];
    
    // Check if post exists and is not already accepted
    $post_query = "SELECT p.post_id FROM posts p 
                   WHERE p.post_id = :post_id 
                   AND NOT EXISTS (
                       SELECT 1 FROM tasks t 
                       WHERE t.post_id = p.post_id AND t.task_status = 'accepted'
                   )";
    $post_stmt = $db->prepare($post_query);
    $post_stmt->bindParam(':post_id', $post_id);
    $post_stmt->execute();
    
    if ($post_stmt->rowCount() === 0) {
        sendResponse(false, null, 'Post not found or already has an accepted bid', 404);
    }
    
    // Check if technician already bid on this post
    $existing_bid_query = "SELECT task_id FROM tasks WHERE post_id = :post_id AND technician_id = :technician_id";
    $existing_stmt = $db->prepare($existing_bid_query);
    $existing_stmt->bindParam(':post_id', $post_id);
    $existing_stmt->bindParam(':technician_id', $technician_id);
    $existing_stmt->execute();
    
    if ($existing_stmt->rowCount() > 0) {
        sendResponse(false, null, 'You have already submitted a bid for this post', 409);
    }
    
    // Submit the bid
    $query = "INSERT INTO tasks (post_id, technician_id, price, task_status) 
              VALUES (:post_id, :technician_id, :price, 'pending')";
    $stmt = $db->prepare($query);
    
    $stmt->bindParam(':post_id', $post_id);
    $stmt->bindParam(':technician_id', $technician_id);
    $stmt->bindParam(':price', $price);
    
    if ($stmt->execute()) {
        $task_id = $db->lastInsertId();
        sendResponse(true, ['task_id' => $task_id], 'Bid submitted successfully');
    } else {
        sendResponse(false, null, 'Failed to submit bid', 500);
    }
} catch(PDOException $exception) {
    error_log("Submit bid error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to submit bid', 500);
}
?>