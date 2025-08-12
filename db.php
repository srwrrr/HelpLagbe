<?php
$host = "localhost";   // Database host
$user = "root";        // MySQL username
$pass = "";            // MySQL password (leave empty if none)
$dbname = "helplagbe"; // Database name

// Create connection
$conn = new mysqli($host, $user, $pass, $dbname);

// Check connection
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}
?>