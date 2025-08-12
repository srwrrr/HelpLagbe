<?php
require 'db.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $fullname = $_POST['fullname'];
    $email = $_POST['email'];
    $phone = $_POST['phone'];
    $password = password_hash($_POST['password'], PASSWORD_DEFAULT);
    $address = $_POST['address'];

    $stmt = $conn->prepare("INSERT INTO users (username, email, phone_no, password, address) VALUES (?, ?, ?, ?, ?)");
    $stmt->bind_param("sssss", $fullname, $email, $phone, $password, $address);

    if ($stmt->execute()) {
        echo "<script>alert('Registration successful! Please log in.'); window.location.href='login.html';</script>";
    } else {
        echo "<script>alert('Error: Could not register user.'); window.location.href='login.html';</script>";
    }
}
