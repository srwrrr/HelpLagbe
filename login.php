<?php
session_start();
require 'db.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Validate email
    $email = trim($_POST['email']);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        die("<script>alert('Invalid email format.'); window.location.href='login.html';</script>");
    }

    $password = $_POST['password'];

    // Fetch user + technician_id in one query
    $stmt = $conn->prepare("
        SELECT u.*, t.technician_id 
        FROM users u
        LEFT JOIN technician t ON u.user_id = t.user_id
        WHERE u.email = ?
    ");
    $stmt->bind_param("s", $email);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows > 0) {
        $user = $result->fetch_assoc();

        if (password_verify($password, $user['password'])) {
            // Store session data
            $_SESSION['user_id'] = $user['user_id'];
            $_SESSION['username'] = $user['username'];

            // Redirect based on technician status
            if (!empty($user['technician_id'])) {
                $_SESSION['technician_id'] = $user['technician_id'];
                header("Location: techdash.php");
            } else {
                header("Location: userdash.php");
            }
            exit();
        } else {
            echo "<script>alert('Invalid password'); window.location.href='login.html';</script>";
        }
    } else {
        echo "<script>alert('User not found'); window.location.href='login.html';</script>";
    }
}
?>