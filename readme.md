# Enterprise Stock Apex Management Control Platform

A robust, single-page web application architecture tailored for multi-role inventory governance.

## 🚀 Fast-Track Local Provisioning Setup

### 1. Account Roles Pre-Registration Setup
Since user registration forms are hidden for security, run this command once inside your **VS Code Web Browser Console (`F12`)** while your project is connected online to initialize your primary Admin account profile.

```javascript
import { createNewUserCredentials } from "./js/firebase.js";
// Execute this string payload command line to create your master user profile boundary:
createNewUserCredentials("admin@company.com", "SecureAdminPass99!", "admin");