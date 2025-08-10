<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] == 'GET') {
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
    if (!$decoded || $decoded['role'] !== 'admin') {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Admin access required"]);
        exit();
    }
    
    $database = new Database();
    $db = $database->getConnection();
    
    // Get various statistics
    $stats = [];
    
    // Total users
    $user_query = "SELECT COUNT(*) as total_users FROM users";
    $user_stmt = $db->prepare($user_query);
    $user_stmt->execute();
    $stats['total_users'] = $user_stmt->fetch(PDO::FETCH_ASSOC)['total_users'];
    
    // Total technicians
    $tech_query = "SELECT COUNT(*) as total_technicians FROM technician WHERE status = 'approved'";
    $tech_stmt = $db->prepare($tech_query);
    $tech_stmt->execute();
    $stats['total_technicians'] = $tech_stmt->fetch(PDO::FETCH_ASSOC)['total_technicians'];
    
    // Pending technicians
    $pending_query = "SELECT COUNT(*) as pending_technicians FROM technician WHERE status = 'pending'";
    $pending_stmt = $db->prepare($pending_query);
    $pending_stmt->execute();
    $stats['pending_technicians'] = $pending_stmt->fetch(PDO::FETCH_ASSOC)['pending_technicians'];
    
    // Total posts
    $posts_query = "SELECT COUNT(*) as total_posts FROM posts";
    $posts_stmt = $db->prepare($posts_query);
    $posts_stmt->execute();
    $stats['total_posts'] = $posts_stmt->fetch(PDO::FETCH_ASSOC)['total_posts'];
    
    // Completed tasks
    $completed_query = "SELECT COUNT(*) as completed_tasks FROM tasks WHERE task_status = 'completed'";
    $completed_stmt = $db->prepare($completed_query);
    $completed_stmt->execute();
    $stats['completed_tasks'] = $completed_stmt->fetch(PDO::FETCH_ASSOC)['completed_tasks'];
    
    // Total revenue
    $revenue_query = "SELECT COALESCE(SUM(amount), 0) as total_revenue FROM payment WHERE payment_status = 'completed'";
    $revenue_stmt = $db->prepare($revenue_query);
    $revenue_stmt->execute();
    $stats['total_revenue'] = $revenue_stmt->fetch(PDO::FETCH_ASSOC)['total_revenue'];
    
    http_response_code(200);
    echo json_encode([
        "success" => true,
        "stats" => $stats
    ]);
}