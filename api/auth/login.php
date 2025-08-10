<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    include_once '../../config/database.php';
    include_once '../../utils/JWTHelper.php';

    $database = new Database();
    $db = $database->getConnection();

    $data = json_decode(file_get_contents("php://input"));

    if (!empty($data->email) && !empty($data->password)) {
        $query = "SELECT user_id, username, email, password, phone_no, address, Image FROM users WHERE email = :email";
        $stmt = $db->prepare($query);
        $stmt->bindParam(':email', $data->email);
        $stmt->execute();

        if ($stmt->rowCount() > 0) {
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            if (password_verify($data->password, $user['password'])) {
                $token = JWTHelper::generateToken($user['user_id'], $user['email']);

                http_response_code(200);
                echo json_encode([
                    "success" => true,
                    "message" => "Login successful",
                    "token" => $token,
                    "user" => [
                        "user_id" => $user['user_id'],
                        "username" => $user['username'],
                        "email" => $user['email'],
                        "phone_no" => $user['phone_no'],
                        "address" => $user['address'],
                        "image" => $user['Image']
                    ]
                ]);
            } else {
                http_response_code(401);
                echo json_encode(["success" => false, "message" => "Invalid credentials"]);
            }
        } else {
            http_response_code(404);
            echo json_encode(["success" => false, "message" => "User not found"]);
        }
    } else {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Email and password are required"]);
    }
}
