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
    if (!$decoded) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid token"]);
        exit();
    }
    
    $database = new Database();
    $db = $database->getConnection();
    
    $query = "SELECT * FROM user_posts_with_bids WHERE user_id = :user_id ORDER BY created_at DESC";
    $stmt = $db->prepare($query);
    $stmt->bindParam(':user_id', $decoded['user_id']);
    $stmt->execute();
    
    $posts = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    http_response_code(200);
    echo json_encode([
        "success" => true,
        "posts" => $posts
    ]);
}