<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
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
    
    // Check if user is a technician
    $tech_query = "SELECT technician_id FROM technician WHERE user_id = :user_id AND status = 'approved'";
    $tech_stmt = $db->prepare($tech_query);
    $tech_stmt->bindParam(':user_id', $decoded['user_id']);
    $tech_stmt->execute();
    
    if ($tech_stmt->rowCount() == 0) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Only approved technicians can submit bids"]);
        exit();
    }
    
    $technician = $tech_stmt->fetch(PDO::FETCH_ASSOC);
    $data = json_decode(file_get_contents("php://input"));
    
    if (!empty($data->post_id) && !empty($data->price)) {
        // Check if bid already exists
        $check_query = "SELECT task_id FROM tasks WHERE post_id = :post_id AND technician_id = :technician_id";
        $check_stmt = $db->prepare($check_query);
        $check_stmt->bindParam(':post_id', $data->post_id);
        $check_stmt->bindParam(':technician_id', $technician['technician_id']);
        $check_stmt->execute();
        
        if ($check_stmt->rowCount() > 0) {
            http_response_code(409);
            echo json_encode(["success" => false, "message" => "You have already submitted a bid for this post"]);
            exit();
        }
        
        $query = "INSERT INTO tasks (post_id, technician_id, price, task_status) VALUES (:post_id, :technician_id, :price, 'pending')";
        $stmt = $db->prepare($query);
        
        $stmt->bindParam(':post_id', $data->post_id);
        $stmt->bindParam(':technician_id', $technician['technician_id']);
        $stmt->bindParam(':price', $data->price);
        
        if ($stmt->execute()) {
            http_response_code(201);
            echo json_encode([
                "success" => true,
                "message" => "Bid submitted successfully",
                "task_id" => $db->lastInsertId()
            ]);
        } else {
            http_response_code(500);
            echo json_encode(["success" => false, "message" => "Failed to submit bid"]);
        }
    } else {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Post ID and price are required"]);
    }
}