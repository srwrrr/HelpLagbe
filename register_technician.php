<?php
require 'db.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $fullname = $_POST['fullname'];
    $nid = $_POST['nid'];
    $email = $_POST['email'];
    $phone = $_POST['phone'];
    $skills = $_POST['skills'];
    $address = $_POST['address'];


    // Create user account
    $password = password_hash("default123", PASSWORD_DEFAULT); // Default password or you can ask for one
    $stmt_user = $conn->prepare("INSERT INTO users (username, email, phone_no, password) VALUES (?, ?, ?, ?)");
    $stmt_user->bind_param("ssss", $fullname, $email, $phone, $password);

    if ($stmt_user->execute()) {
        $user_id = $stmt_user->insert_id;

        // Upload document if provided
        $docPath = null;
        if (!empty($_FILES['documents']['name'])) {
            $targetDir = "uploads/";
            if (!file_exists($targetDir)) {
                mkdir($targetDir, 0777, true);
            }
            $docPath = $targetDir . basename($_FILES["documents"]["name"]);
            move_uploaded_file($_FILES["documents"]["tmp_name"], $docPath);
        }

        // Insert into technician table with pending status
        $stmt_tech = $conn->prepare("INSERT INTO technician (national_id, Full_Name, Required_Documents, Skill_details, address, user_id, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')");
        $stmt_tech->bind_param("sssssi", $nid, $fullname, $docPath, $skills, $address, $user_id);
        $stmt_tech->execute();

        // Show success message and stay on registration page
        echo "<script>
            alert('Your application has been submitted. Awaiting approval.');
            window.location.href='login.html'; // Keep them on login so they can log in later
        </script>";
    } else {
        echo "<script>alert('Error: Could not register technician.'); window.location.href='login.html';</script>";
    }
}
?>