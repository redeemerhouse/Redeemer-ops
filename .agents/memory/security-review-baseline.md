---
name: Security review baseline
description: Durable security boundary and contract-enforcement principle for this product.
---

The browser, mockup canvas, OpenAPI document, generated hooks, and generated Zod schemas are not security boundaries. The Express route/middleware plus scoped service/data-access layer is the enforcement boundary for resident and payment data.

**Why:** The project can contain generated sensitive CRUD surfaces before their server routes exist, and client-side validation or generated types cannot prevent a crafted request from reaching the API.

**How to apply:** For every future sensitive route, require server authentication, centralized authorization scope, request and response validation, server-authoritative financial/ownership fields, and database relationship/invariant checks before considering the feature shippable.