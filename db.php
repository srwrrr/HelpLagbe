<?php
$host = 'localhost';
$dbname = 'helplagbe'; // Change to your database name
$username = 'root';
$password = ''; // Default XAMPP password is blank

try {
    $conn = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $username, $password);
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die(json_encode(['status' => 'error', 'message' => 'DB Connection Failed: ' . $e->getMessage()]));
}
?>
