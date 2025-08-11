<?php
// api/posts/{post_id}.php
include_once '../config/database.php';

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

// Extract post_id from URL
$request_uri = $_SERVER['REQUEST_URI'];
$path_parts = explode('/', $request_uri);
$post_id = end($path_parts);

if (!is_numeric($post_id)) {
    sendResponse(false, null, 'Invalid post ID', 400);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Get specific post
    try {
        $query = "SELECT p.*, u.username as customer_name 
                  FROM posts p 
                  JOIN users u ON p.user_id = u.user_id 
                  WHERE p.post_id = :post_id";
        $stmt = $db->prepare($query);
        $stmt->bindParam(':post_id', $post_id);
        $stmt->execute();
        
        if ($stmt->rowCount() > 0) {
            $post = $stmt->fetch(PDO::FETCH_ASSOC);
            sendResponse(true, $post, 'Post retrieved successfully');
        } else {
            sendResponse(false, null, 'Post not found', 404);
        }
    } catch(PDOException $exception) {
        error_log("Get post error: " . $exception->getMessage());
        sendResponse(false, null, 'Failed to get post', 500);
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    // Update post
    $data = json_decode(file_get_contents("php://input"), true);
    
    try {
        // Check if user owns the post
        $check_query = "SELECT user_id FROM posts WHERE post_id = :post_id";
        $check_stmt = $db->prepare($check_query);
        $check_stmt->bindParam(':post_id', $post_id);
        $check_stmt->execute();
        
        $post = $check_stmt->fetch(PDO::FETCH_ASSOC);
        if (!$post || $post['user_id'] != $user['user_id']) {
            sendResponse(false, null, 'Unauthorized', 403);
        }
        
        $updates = [];
        $params = [':post_id' => $post_id];
        
        if (isset($data['category'])) {
            $updates[] = "Category = :category";
            $params[':category'] = sanitizeInput($data['category']);
        }
        
        if (isset($data['description'])) {
            $updates[] = "Post_detail = :description";
            $params[':description'] = sanitizeInput($data['description']);
        }
        
        if (isset($data['subcategory'])) {
            $updates[] = "`Sub-Category` = :subcategory";
            $params[':subcategory'] = sanitizeInput($data['subcategory']);
        }
        
        if (!empty($updates)) {
            $query = "UPDATE posts SET " . implode(', ', $updates) . ", updated_at = CURRENT_TIMESTAMP WHERE post_id = :post_id";
            $stmt = $db->prepare($query);
            
            if ($stmt->execute($params)) {
                sendResponse(true, null, 'Post updated successfully');
            } else {
                sendResponse(false, null, 'Failed to update post', 500);
            }
        } else {
            sendResponse(false, null, 'No fields to update', 400);
        }
    } catch(PDOException $exception) {
        error_log("Update post error: " . $exception->getMessage());
        sendResponse(false, null, 'Failed to update post', 500);
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    // Delete post
    try {
        // Check if user owns the post
        $check_query = "SELECT user_id FROM posts WHERE post_id = :post_id";
        $check_stmt = $db->prepare($check_query);
        $check_stmt->bindParam(':post_id', $post_id);
        $check_stmt->execute();
        
        $post = $check_stmt->fetch(PDO::FETCH_ASSOC);
        if (!$post || $post['user_id'] != $user['user_id']) {
            sendResponse(false, null, 'Unauthorized', 403);
        }
        
        // Delete associated tasks first
        $delete_tasks_query = "DELETE FROM tasks WHERE post_id = :post_id";
        $delete_tasks_stmt = $db->prepare($delete_tasks_query);
        $delete_tasks_stmt->bindParam(':post_id', $post_id);
        $delete_tasks_stmt->execute();
        
        // Delete the post
        $query = "DELETE FROM posts WHERE post_id = :post_id";
        $stmt = $db->prepare($query);
        $stmt->bindParam(':post_id', $post_id);
        
        if ($stmt->execute()) {
            sendResponse(true, null, 'Post deleted successfully');
        } else {
            sendResponse(false, null, 'Failed to delete post', 500);
        }
    } catch(PDOException $exception) {
        error_log("Delete post error: " . $exception->getMessage());
        sendResponse(false, null, 'Failed to delete post', 500);
    }
} else {
    sendResponse(false, null, 'Method not allowed', 405);
}
?>

<?php
// api/posts/{post_id}/bids.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

// Extract post_id from URL
$request_uri = $_SERVER['REQUEST_URI'];
$path_parts = explode('/', $request_uri);
$post_id = $path_parts[array_search('posts', $path_parts) + 1];

if (!is_numeric($post_id)) {
    sendResponse(false, null, 'Invalid post ID', 400);
}

try {
    // Check if user owns the post
    $check_query = "SELECT user_id FROM posts WHERE post_id = :post_id";
    $check_stmt = $db->prepare($check_query);
    $check_stmt->bindParam(':post_id', $post_id);
    $check_stmt->execute();
    
    $post = $check_stmt->fetch(PDO::FETCH_ASSOC);
    if (!$post || $post['user_id'] != $user['user_id']) {
        sendResponse(false, null, 'Unauthorized', 403);
    }
    
    // Get all bids for this post
    $query = "SELECT t.task_id as id, t.price, t.task_status as status, t.created_at,
                     tech.Full_Name as technician_name, tech.Skill_details as skills,
                     u.phone_no as phone, u.email,
                     COALESCE(AVG(tf.consumer_rating), 0) as rating,
                     COUNT(completed_tasks.task_id) as experience
              FROM tasks t
              JOIN technician tech ON t.technician_id = tech.technician_id
              JOIN users u ON tech.user_id = u.user_id
              LEFT JOIN task_feedback tf ON t.task_id = tf.task_id
              LEFT JOIN tasks completed_tasks ON completed_tasks.technician_id = tech.technician_id 
                       AND completed_tasks.task_status = 'completed'
              WHERE t.post_id = :post_id
              GROUP BY t.task_id
              ORDER BY t.created_at ASC";
    
    $stmt = $db->prepare($query);
    $stmt->bindParam(':post_id', $post_id);
    $stmt->execute();
    
    $bids = $stmt->fetchAll(PDO::FETCH_ASSOC);
    sendResponse(true, $bids, 'Bids retrieved successfully');
    
} catch(PDOException $exception) {
    error_log("Get bids error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to get bids', 500);
}
?>