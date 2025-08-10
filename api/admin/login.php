<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    include_once '../config/database.php';
    include_once '../utils/JWTHelper.php';
    
    $database = new Database();
    $db = $database->getConnection();
    
    $data = json_decode(file_get_contents("php://input"));
    
    if (!empty($data->username) && !empty($data->password)) {
        // For demo purposes, using simple admin credentials
        // In production, store hashed passwords in admin table
        if ($data->username === 'admin' && $data->password === 'admin123') {
            $token = JWTHelper::generateToken(1, 'admin@helplagbe.com', 'admin');
            
            http_response_code(200);
            echo json_encode([
                "success" => true,
                "message" => "Admin login successful",
                "token" => $token,
                "admin" => [
                    "admin_id" => 1,
                    "username" => "admin"
                ]
            ]);
        } else {
            http_response_code(401);
            echo json_encode(["success" => false, "message" => "Invalid admin credentials"]);
        }
    } else {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Username and password are required"]);
    }
}