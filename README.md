# Music Blog Cloud Platform ☁️🎵
### (Angular, Node.js, Express, AWS EC2, AWS Lambda, Amazon RDS, Amazon S3)

> A full-stack publishing platform that combines a public music experience with a secure, event-driven content workflow.

**Portfolio focus:** Angular · Node.js · AWS serverless workflows · relational data · media processing

## Contents

- [Introduction](#introduction)
- [How to Run](#how-to-run)
- [Architecture](#architecture)
- [Cloud Architecture & Security](#cloud-architecture--security)
- [Improvements](#improvements)
- [Conclusion](#conclusion)

## Introduction

This project is a full-stack, cloud-native Music Blog. It utilizes a robust AWS infrastructure to deliver a seamless experience for both public readers and content administrators. The platform features an Angular-based public view and a dedicated Headless CMS for the admin dashboard. The backend relies heavily on scalable cloud services to handle event-driven media compression, automated scheduled tasks, and secure data ingestion.

## How to Run

1. Clone the repository and install dependencies for the local environment
```bash
npm install
```
2. Set up your local .env with your AWS credentials, RDS connection strings, and JWT secrets
```bash
cp .env.example .env
# Edit .env with your specific variables
```
3. Start the local development server (which mocks the EC2 environment)
```bash
npm run start:dev
```

## Architecture

![Diagram](diagram.png)

- Local Environment (Angular/CMS): Handles the client-side rendering for public views and the secure interface for content editors.
- Amazon EC2 (Node.js/Express): Acts as the primary API gateway, orchestrating incoming requests, authenticating users, and routing database operations.
- AWS Lambda: Runs scheduled Python scripts independently from the main web server to handle background tasks like data scraping and ingestion.
- Amazon RDS: Provides a highly available relational PostgreSQL database for storing articles, metadata, and user credentials.
- Amazon S3: Manages the storage and event-driven compression of static assets (images and audio).

## Cloud Architecture & Security

Cloud Infrastructure

  - The cloud architecture is the backbone of this application. By decoupling the API (EC2) from background processing (Lambda) and static asset delivery (S3), the system achieves high availability and fault tolerance.

  - Automated Scripts on Lambda Scheduler: Python scripts are deployed as serverless AWS Lambda functions triggered by EventBridge (CloudWatch Events) schedules. This ensures that heavy tasks, such as external data scraping or routine database maintenance, do not consume EC2 resources or block the event loop of the Node.js server.

  - Event-Driven Media Compression: When an administrator uploads an image or audio file through the CMS, the file is pushed to an S3 bucket. This triggers an event-driven workflow that automatically compresses images to the highly efficient WebP format and standardizes audio bitrates, saving bandwidth and improving load times on the Angular frontend.

Privacy and Security

  - Secure Data Ingestion & API Queries: Data ingested by the Lambda scripts and EC2 instances is sanitized using parameterized queries via the pg library to prevent SQL injection attacks. The API layer utilizes strict CORS policies, rate limiting, and payload validation to ensure that only expected data shapes are processed.

  - Session-Based Admin Authentication: The Headless CMS admin page is protected by a complete session-based login system. It utilizes secure, HttpOnly cookies and JSON Web Tokens (JWTs) to maintain session state. All CRUD operations targeting the RDS database or S3 buckets enforce authorization checks at the API gateway layer to verify that the requester holds an active, elevated admin session.

## Improvements

- Infrastructure as Code (IaC): Migrate the manual AWS configuration to an IaC tool like Terraform or AWS CDK. This would allow the entire cloud architecture (EC2, Lambda, RDS, S3) to be version-controlled and reproducible.
- CDN Integration: Place an Amazon CloudFront distribution in front of the S3 bucket to cache compressed WebP images and audio files closer to the end-users globally, further reducing latency.
- Enhanced Observability: Integrate AWS CloudWatch or Datadog for centralized logging, tracing, and alarming, specifically monitoring the Lambda execution success rates and API response times.

## Conclusion

Thanks for reading up until here. I had a ton of fun doing this project and got a lot of useful insights on AWS cloud architectures, serverless scripting with Lambda, and securing Node.js APIs. If you want to see similar projects, go to my github page. Feel free to reach me on [LinkedIn](https://www.linkedin.com/in/isaiapedro/) or my [Webpage](https://isaiapedro.github.io/).

Bye! 👋
