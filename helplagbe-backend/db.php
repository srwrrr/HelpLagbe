<?php
$host = "localhost";
$dbname = "helplagbe_db";
$username = "dbuser";
$password = "dbpassword";

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (Exception $e) {
    die("Database connection error: " . $e->getMessage());
}
