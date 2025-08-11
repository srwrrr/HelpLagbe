<?php
// api/posts/create.php
include_once '../config/database.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendResponse(false, null, 'Method not allowed', 405);
}

$user = requireAuth();
$database = new Database();
$db = $database->getConnection();

$data = json_decode(file_get_contents("php://input"), true);

if (!$data) {
    sendResponse(false, null, 'Invalid JSON data', 400);
}

$required_fields = ['category', 'description'];
$missing_fields = validateRequired($data, $required_fields);

if (!empty($missing_fields)) {
    sendResponse(false, null, 'Missing required fields: ' . implode(', ', $missing_fields), 400);
}

$category = sanitizeInput($data['category']);
$description = sanitizeInput($data['description']);
$subcategory = isset($data['subcategory']) ? sanitizeInput($data['subcategory']) : null;
$budget = isset($data['budget']) ? sanitizeInput($data['budget']) : null;
$preferred_time = isset($data['preferred_time']) ? $data['preferred_time'] : null;

try {
    $query = "INSERT INTO posts (Post_detail, Category, `Sub-Category`, user_id) 
              VALUES (:description, :category, :subcategory, :user_id)";
    $stmt = $db->prepare($query);
    
    $stmt->bindParam(':description', $description);
    $stmt->bindParam(':category', $category);
    $stmt->bindParam(':subcategory', $subcategory);
    $stmt->bindParam(':user_id', $user['user_id']);
    
    if ($stmt->execute()) {
        $post_id = $db->lastInsertId();
        sendResponse(true, ['post_id' => $post_id], 'Post created successfully');
    } else {
        sendResponse(false, null, 'Failed to create post', 500);
    }
} catch(PDOException $exception) {
    error_log("Create post error: " . $exception->getMessage());
    sendResponse(false, null, 'Failed to create post', 500);
}
?>