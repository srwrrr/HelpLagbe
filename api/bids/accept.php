<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: PUT");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] == 'PUT') {
    include_once '../config/database.php';
    include_once '../utils/JWTHelper.php';
    
    $headers = getallheaders();
    $token = isset($headers['Authorization']) ? str_replace('Bearer ', '', $headers['Authorization']) : null;
    
    if (!$token) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Authorization token required"]);
        exit();
    }
    
    $decoded = JWTHelper::validateToken($token);
    if (!$decoded) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid token"]);
        exit();
    }
    
    $database = new Database();
    $db = $database->getConnection();
    
    $task_id = isset($_GET['id']) ? $_GET['id'] : null;
    
    if (!$task_id) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Task ID is required"]);
        exit();
    }
    
    // Verify the post belongs to the current user
    $verify_query = "SELECT t.task_id, p.user_id FROM tasks t 
                     JOIN posts p ON t.post_id = p.post_id 
                     WHERE t.task_id = :task_id AND p.user_id = :user_id";
    $verify_stmt = $db->prepare($verify_query);
    $verify_stmt->bindParam(':task_id', $task_id);
    $verify_stmt->bindParam(':user_id', $decoded['user_id']);
    $verify_stmt->execute();
    
    if ($verify_stmt->rowCount() == 0) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "You can only accept bids on your own posts"]);
        exit();
    }
    
    $db->beginTransaction();
    
    try {
        // Update the accepted bid
        $accept_query = "UPDATE tasks SET task_status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE task_id = :task_id";
        $accept_stmt = $db->prepare($accept_query);
        $accept_stmt->bindParam(':task_id', $task_id);
        $accept_stmt->execute();
        
        // Get post_id for cancelling other bids
        $post_query = "SELECT post_id FROM tasks WHERE task_id = :task_id";
        $post_stmt = $db->prepare($post_query);
        $post_stmt->bindParam(':task_id', $task_id);
        $post_stmt->execute();
        $post_data = $post_stmt->fetch(PDO::FETCH_ASSOC);
        
        // Cancel other pending bids for the same post
        $cancel_query = "UPDATE tasks SET task_status = 'cancelled' WHERE post_id = :post_id AND task_id != :task_id AND task_status = 'pending'";
        $cancel_stmt = $db->prepare($cancel_query);
        $cancel_stmt->bindParam(':post_id', $post_data['post_id']);
        $cancel_stmt->bindParam(':task_id', $task_id);
        $cancel_stmt->execute();
        
        $db->commit();
        
        http_response_code(200);
        echo json_encode([
            "success" => true,
            "message" => "Bid accepted successfully"
        ]);
        
    } catch (Exception $e) {
        $db->rollback();
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "Failed to accept bid"]);
    }
}