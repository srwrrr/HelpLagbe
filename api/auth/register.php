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
    
    if (!empty($data->username) && !empty($data->email) && !empty($data->password)) {
        // Check if email already exists
        $check_query = "SELECT user_id FROM users WHERE email = :email";
        $check_stmt = $db->prepare($check_query);
        $check_stmt->bindParam(':email', $data->email);
        $check_stmt->execute();
        
        if ($check_stmt->rowCount() > 0) {
            http_response_code(409);
            echo json_encode(["success" => false, "message" => "Email already exists"]);
            exit();
        }
        
        $query = "INSERT INTO users (username, email, password, phone_no, address) VALUES (:username, :email, :password, :phone_no, :address)";
        $stmt = $db->prepare($query);
        
        $hashed_password = password_hash($data->password, PASSWORD_DEFAULT);
        
        $stmt->bindParam(':username', $data->username);
        $stmt->bindParam(':email', $data->email);
        $stmt->bindParam(':password', $hashed_password);
        $stmt->bindParam(':phone_no', $data->phone_no ?? null);
        $stmt->bindParam(':address', $data->address ?? null);
        
        if ($stmt->execute()) {
            $user_id = $db->lastInsertId();
            $token = JWTHelper::generateToken($user_id, $data->email);
            
            http_response_code(201);
            echo json_encode([
                "success" => true,
                "message" => "User registered successfully",
                "token" => $token,
                "user" => [
                    "user_id" => $user_id,
                    "username" => $data->username,
                    "email" => $data->email
                ]
            ]);
        } else {
            http_response_code(500);
            echo json_encode(["success" => false, "message" => "Registration failed"]);
        }
    } else {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Username, email and password are required"]);
    }
}