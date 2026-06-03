# Developer API Documentation

Welcome to the EbotConnect Developer API! This API allows you to integrate your applications with your WhatsApp bot, enabling you to check its status and send messages programmatically.

## Authentication

All API requests must be authenticated using an API Key. 

1. Generate your API key in the **Developer API** section of your EbotConnect Dashboard.
2. Include the API key in the `x-api-key` header of your HTTP requests.

**Example Header:**
```http
x-api-key: ebot_your_generated_api_key_here
```

---

## Endpoints

### 1. Check Bot Status
Check if your WhatsApp session is currently connected and active.

- **URL:** `GET /api/v1/status`
- **Headers:** 
  - `x-api-key`: Your API key
- **Response (200 OK):**
```json
{
  "status": "connected",
  "connected_at": "2023-10-25T14:30:00.000Z"
}
```

---

### 2. Send a Message
Send a WhatsApp message to any phone number. Ensure the phone number includes the country code.

- **URL:** `POST /api/v1/messages/send`
- **Headers:** 
  - `x-api-key`: Your API key
  - `Content-Type`: `application/json`
- **Body:**
```json
{
  "to": "1234567890",
  "message": "Hello from the Developer API!"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Message sent successfully"
}
```

---

## Example Request (cURL)

Here is a quick example of how to send a message using the command line:

```bash
curl -X POST http://your-render-url.onrender.com/api/v1/messages/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_api_key_here" \
  -d '{"to":"1234567890", "message":"Hello World!"}'
```

---

## Important Notes

1. **Active Subscription Required:** You must have an active EbotConnect subscription to use the API. If your subscription expires, your API key will stop working.
2. **Rate Limiting:** To prevent abuse, the API is rate-limited to 100 requests every 15 minutes per IP address.
3. **Security:** Never share your API key publicly. If your key is compromised, immediately revoke it in the dashboard and generate a new one.
