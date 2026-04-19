# DoppelDash

## Enterprise Administrative Toolsuite (CRM, LMS, RMS)

A comprehensive internal management system built with the MERN stack (MongoDB, Express.js, React, Node.js), featuring a glassmorphism UI design for a modern, responsive experience.

### Overview

DoppelDash is designed to automate and streamline enterprise administrative processes through three integrated modules:

1. **Stakeholder CRM**: Advanced client relationship management with Outlook integration, business card scanning, and AI-powered content generation.
2. **Leave Management System (LMS)**: Smart time-off tracking with conditional workflows and approval pipelines.
3. **Reimbursement & Expense Tracker (RMS)**: Visual pipeline-based system for expense management and travel requests.

### Key Features

#### Stakeholder CRM
- **Outlook Integration**: Bi-directional syncing of emails, calendar events, and meetings using Microsoft Graph API
- **Business Card Scanner**: Mobile-responsive OCR feature for automatic profile creation
- **Advanced Profiling**: Comprehensive demographic data with privacy controls
- **AI Automation**: Automated greetings and one-click content generation using local LLM or OpenAI API

#### Leave Management System (LMS)
- **Real-time Balance Tracking**: Monthly and annual leave quotas (Casual, Medical, Earned)
- **Conditional Workflows**: Dynamic requirements based on leave type and duration
- **Approval Pipeline**: Multi-tier review process with notifications

#### Reimbursement & Expense Tracker (RMS)
- **Travel & Expense Submission**: Streamlined request creation with mandatory documentation
- **3-Tier Billing Pipeline**: Manager review → Boss approval → Payment processing
- **Visual Pipeline**: Kanban-style dashboards for tracking progress

### Tech Stack
- **Frontend**: React.js with Tailwind CSS, Framer Motion, Shadcn UI
- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **File Storage**: AWS S3 or Cloudinary
- **Integrations**: Microsoft Graph API, OCR services, AI APIs
- **UI Design**: Glassmorphism aesthetic with responsive mobile-first approach

### Architecture Highlights
- **Role-Based Access Control (RBAC)**: Employee, Manager, and Boss (Super Admin) roles
- **Progressive Web App (PWA)**: Native mobile app experience for camera features
- **Automated Workflows**: Cron jobs for scheduled tasks and greetings
- **Secure File Handling**: Multi-image uploads with validation

### Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables
4. Run the development server: `npm start`

### Contributing

Please read the contributing guidelines before making contributions.

### License

[Add license information]