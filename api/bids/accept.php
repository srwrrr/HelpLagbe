<?php
// api/bids/{bid_id}/accept.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'PUT') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

// Extract bid_id from URL
$request_uri = $_SERVER['REQUEST_URI'];
$path_parts = explode('/', $request_uri);
$bid_id = $path_parts[array_search('bids', $path_parts) + 1];

if (!is_numeric($bid_id)) {
    sendResponse(false, null, 'Invalid bid ID', 400);
}

try {
    // Check if user owns the post for this bid
    $check_query = "SELECT t.task_id, t.post_id, p.user_id 
                    FROM tasks t
                    JOIN posts p ON t.post_id = p.post_id
                    WHERE t.task_id = :bid_id AND t.task_status = 'pending'";
    $check_stmt = $db->prepare($check_query);
    $check_stmt->bindParam(':bid_id', $bid_id);
    $check_stmt->execute();
    
    if ($check_stmt->rowCount() === 0) {
        sendResponse(false, null, 'Bid not found or already processed', 404);
    }
    
    $task = $check_stmt->fetch(PDO::FETCH_ASSOC);
    if ($task['user_id'] != $user['user_id']) {
        sendResponse(false, null, 'Unauthorized', 403);
    }
    
    $db->beginTransaction();
    
    try {
        // Accept the bid
        $accept_query = "UPDATE tasks SET task_status = 'accepted', accepted_at = CURRENT_TIMESTAMP 
                         WHERE task_id = :bid_id";
        $accept_stmt = $db->prepare($accept_query);
        $accept_stmt->bindParam(':bid_id', $bid_id);
        $accept_stmt->execute();
        
        // Reject all other bids for the same post
        $reject_query = "UPDATE tasks SET task_status = 'rejected' 
                         WHERE post_id = :post_id AND task_id != :bid_id AND task_status = 'pending'";
        $reject_stmt = $db->prepare($reject_query);
        $reject_stmt->bindParam(':post_id', $task['post_id']);
        $reject_stmt->bindParam(':bid_id', $bid_id);
        $reject_stmt->execute();
        
        $db->commit();
        sendResponse(true, null, 'Bid accepted successfully');
        
    } catch (Exception $e) {
        $db->rollback();
        throw $e;
    }
    
} catch(PDOException $exception) {
    error_log("Accept bid error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to accept bid', 500);
}
?>