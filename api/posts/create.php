<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    include_once '../config/database.php';
    include_once '../utils/JWTHelper.php';
    
    // Get JWT token from header
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
    
    $data = json_decode(file_get_contents("php://input"));
    
    if (!empty($data->post_detail) && !empty($data->category)) {
        $query = "INSERT INTO posts (Post_detail, Image, Category, `Sub-Category`, user_id) VALUES (:post_detail, :image, :category, :sub_category, :user_id)";
        $stmt = $db->prepare($query);
        
        $stmt->bindParam(':post_detail', $data->post_detail);
        $stmt->bindParam(':image', $data->image ?? null);
        $stmt->bindParam(':category', $data->category);
        $stmt->bindParam(':sub_category', $data->sub_category ?? null);
        $stmt->bindParam(':user_id', $decoded['user_id']);
        
        if ($stmt->execute()) {
            http_response_code(201);
            echo json_encode([
                "success" => true,
                "message" => "Post created successfully",
                "post_id" => $db->lastInsertId()
            ]);
        } else {
            http_response_code(500);
            echo json_encode(["success" => false, "message" => "Failed to create post"]);
        }
    } else {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Post detail and category are required"]);
    }
}