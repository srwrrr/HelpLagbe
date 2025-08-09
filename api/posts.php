<?php
require_once 'config.php';

session_start();

// Check if user is logged in
function requireAuth() {
    if (!isset($_SESSION['logged_in']) || $_SESSION['logged_in'] !== true) {
        sendResponse(false, 'Authentication required');
    }
}

$conn = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);

switch ($method) {
    case 'GET':
        if (isset($_GET['action'])) {
            switch ($_GET['action']) {
                case 'user_posts':
                    requireAuth();
                    getUserPosts($conn, $_SESSION['user_id']);
                    break;
                case 'available_tasks':
                    requireAuth();
                    getAvailableTasks($conn);
                    break;
                case 'post_bids':
                    requireAuth();
                    getPostBids($conn, $_GET['post_id']);
                    break;
                default:
                    sendResponse(false, 'Invalid action');
            }
        }
        break;
    case 'POST':
        requireAuth();
        if (isset($input['action'])) {
            switch ($input['action']) {
                case 'create_post':
                    createPost($conn, $input, $_SESSION['user_id']);
                    break;
                case 'submit_bid':
                    submitBid($conn, $input, $_SESSION['user_id']);
                    break;
                case 'accept_bid':
                    acceptBid($conn, $input, $_SESSION['user_id']);
                    break;
                default:
                    sendResponse(false, 'Invalid action');
            }
        }
        break;
    default:
        sendResponse(false, 'Method not allowed');
}

function createPost($conn, $data, $user_id) {
    $post_detail = sanitizeInput($data['description']);
    $category = sanitizeInput($data['category']);
    $sub_category = isset($data['sub_category']) ? sanitizeInput($data['sub_category']) : '';
    
    if (empty($post_detail) || empty($category)) {
        sendResponse(false, 'Description and category are required');
    }
    
    // Handle image upload (simplified - in production you'd handle file uploads properly)
    $image_path = '';
    if (isset($data['images']) && !empty($data['images'])) {
        // This would handle actual file upload
        $image_path = 'uploads/' . time() . '.jpg'; // Placeholder
    }
    
    $stmt = $conn->prepare("INSERT INTO Posts (Post_detail, Image, Category, `Sub-Category`, user_id) VALUES (?, ?, ?, ?, ?)");
    $stmt->bind_param("ssssi", $post_detail, $image_path, $category, $sub_category, $user_id);
    
    if ($stmt->execute()) {
        $post_id = $conn->insert_id;
        
        // Get the created post
        $stmt = $conn->prepare("SELECT * FROM Posts WHERE post_id = ?");
        $stmt->bind_param("i", $post_id);
        $stmt->execute();
        $result = $stmt->get_result();
        $post = $result->fetch_assoc();
        
        sendResponse(true, 'Post created successfully', $post);
    } else {
        sendResponse(false, 'Failed to create post');
    }
}

function getUserPosts($conn, $user_id) {
    $stmt = $conn->prepare("
        SELECT p.*, 
               COUNT(t.task_id) as bid_count,
               MAX(t.task_status) as latest_status,
               (SELECT COUNT(*) FROM Tasks WHERE post_id = p.post_id AND task_status = 'accepted') as has_accepted_bid
        FROM Posts p 
        LEFT JOIN Tasks t ON p.post_id = t.post_id 
        WHERE p.user_id = ? 
        GROUP BY p.post_id 
        ORDER BY p.post_id DESC
    ");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    $posts = [];
    while ($row = $result->fetch_assoc()) {
        $posts[] = $row;
    }
    
    sendResponse(true, 'Posts retrieved successfully', $posts);
}

function getAvailableTasks($conn) {
    // Get posts that don't have accepted tasks yet (available for bidding)
    $stmt = $conn->prepare("
        SELECT p.*, u.username as posted_by 
        FROM Posts p 
        JOIN Users u ON p.user_id = u.user_id 
        WHERE p.post_id NOT IN (
            SELECT DISTINCT post_id FROM Tasks WHERE task_status = 'accepted'
        ) 
        ORDER BY p.post_id DESC
    ");
    $stmt->execute();
    $result = $stmt->get_result();
    
    $tasks = [];
    while ($row = $result->fetch_assoc()) {
        $tasks[] = $row;
    }
    
    sendResponse(true, 'Available tasks retrieved successfully', $tasks);
}

function submitBid($conn, $data, $user_id) {
    $post_id = (int)$data['post_id'];
    $price = sanitizeInput($data['price']);
    
    if (empty($post_id) || empty($price)) {
        sendResponse(false, 'Post ID and price are required');
    }
    
    // Check if user is a technician
    $stmt = $conn->prepare("SELECT technician_id FROM technician WHERE user_id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows === 0) {
        sendResponse(false, 'Only registered technicians can submit bids');
    }
    
    $technician = $result->fetch_assoc();
    $technician_id = $technician['technician_id'];
    
    // Check if bid already exists
    $stmt = $conn->prepare("SELECT task_id FROM Tasks WHERE post_id = ? AND technician_id = ?");
    $stmt->bind_param("ii", $post_id, $technician_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows > 0) {
        sendResponse(false, 'You have already submitted a bid for this task');
    }
    
    // Check if post already has accepted bid
    $stmt = $conn->prepare("SELECT task_id FROM Tasks WHERE post_id = ? AND task_status = 'accepted'");
    $stmt->bind_param("i", $post_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows > 0) {
        sendResponse(false, 'This task already has an accepted bid');
    }
    
    // Insert bid
    $stmt = $conn->prepare("INSERT INTO Tasks (task_status, price, post_id, technician_id) VALUES ('pending', ?, ?, ?)");
    $stmt->bind_param("sii", $price, $post_id, $technician_id);
    
    if ($stmt->execute()) {
        sendResponse(true, 'Bid submitted successfully');
    } else {
        sendResponse(false, 'Failed to submit bid');
    }
}

function getPostBids($conn, $post_id) {
    if (!isset($_SESSION['user_id'])) {
        sendResponse(false, 'Authentication required');
    }
    
    // Verify that the post belongs to the current user
    $stmt = $conn->prepare("SELECT user_id FROM Posts WHERE post_id = ?");
    $stmt->bind_param("i", $post_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows === 0) {
        sendResponse(false, 'Post not found');
    }
    
    $post = $result->fetch_assoc();
    if ($post['user_id'] != $_SESSION['user_id']) {
        sendResponse(false, 'Access denied');
    }
    
    // Get bids for the post
    $stmt = $conn->prepare("
        SELECT t.*, tech.Full_Name, u.username, u.phone_no, tech.Skill_details 
        FROM Tasks t 
        JOIN technician tech ON t.technician_id = tech.technician_id 
        JOIN Users u ON tech.user_id = u.user_id 
        WHERE t.post_id = ? 
        ORDER BY CAST(t.price AS DECIMAL) ASC
    ");
    $stmt->bind_param("i", $post_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    $bids = [];
    while ($row = $result->fetch_assoc()) {
        $bids[] = $row;
    }
    
    sendResponse(true, 'Bids retrieved successfully', $bids);
}

function acceptBid($conn, $data, $user_id) {
    $task_id = (int)$data['task_id'];
    
    if (empty($task_id)) {
        sendResponse(false, 'Task ID is required');
    }
    
    // Verify that the task's post belongs to the current user
    $stmt = $conn->prepare("
        SELECT t.task_id, p.user_id, t.post_id
        FROM Tasks t 
        JOIN Posts p ON t.post_id = p.post_id 
        WHERE t.task_id = ?
    ");
    $stmt->bind_param("i", $task_id);
    $stmt->execute();
    $result = $stmt->get_result();
    
    if ($result->num_rows === 0) {
        sendResponse(false, 'Task not found');
    }
    
    $task = $result->fetch_assoc();
    if ($task['user_id'] != $user_id) {
        sendResponse(false, 'Access denied');
    }
    
    // Check if there's already an accepted bid for this post
    $stmt = $conn->prepare("SELECT task_id FROM Tasks WHERE post_id = ? AND task_status = 'accepted'");
    $stmt->bind_param("i", $task['post_id']);
    $stmt->execute();
    $check_result = $stmt->get_result();
    
    if ($check_result->num_rows > 0) {
        sendResponse(false, 'A bid has already been accepted for this post');
    }
    
    // Update task status to accepted
    $stmt = $conn->prepare("UPDATE Tasks SET task_status = 'accepted' WHERE task_id = ?");
    $stmt->bind_param("i", $task_id);
    
    if ($stmt->execute()) {
        sendResponse(true, 'Bid accepted successfully');
    } else {
        sendResponse(false, 'Failed to accept bid');
    }
}
?>