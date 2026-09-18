# Music Blog Cloud Platform ☁️🎵

A music publishing platform with a public reader experience and a protected
admin workflow. Background jobs handle ingestion and media processing without
blocking the main application.

## Contents

- [Introduction](#introduction)
- [How to Run](#how-to-run)
- [Architecture](#architecture)
- [Cloud Architecture & Security](#cloud-architecture--security)
- [Improvements](#improvements)
- [Conclusion](#conclusion)

## Introduction

The Angular frontend serves readers and content editors. A Node.js API manages
application requests, while AWS services provide storage, scheduled work, and
event-driven media processing.

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

- **Angular:** public site and editor interface.
- **Node.js on EC2:** authentication, API requests, and database access.
- **AWS Lambda:** scheduled ingestion and background processing.
- **Amazon RDS:** relational storage for articles and metadata.
- **Amazon S3:** media storage and compression events.

## Cloud Architecture & Security

- EventBridge schedules Lambda jobs independently from the main API.
- S3 upload events trigger image and audio compression.
- Parameterized queries, validation, CORS, and rate limits protect API traffic.
- HttpOnly sessions and authorization checks protect editor operations.

## Improvements

- Define the AWS environment with Terraform or CDK.
- Add CloudFront for media delivery.
- Centralize logs, traces, and alerts.

## Conclusion

This project brings together frontend delivery, API security, relational data,
and event-driven cloud processing in one publishing workflow.
