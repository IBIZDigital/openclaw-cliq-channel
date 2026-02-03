/**
 * Henry Bot Menu Handler - Timecard Report
 * 
 * Add this menu item to Henry in Zoho Cliq:
 * 1. Go to Henry bot settings → Menu
 * 2. Click "Add Menu"
 * 3. Name: "📊 Daily Timecard"
 * 4. Paste the Deluge code below
 */

// ============================================================
// DELUGE CODE FOR MENU HANDLER - Copy everything below
// ============================================================

/*
response = Map();

// Channel to read timecards from
timecard_channel = "ibizcompanywide";
timecard_chat_id = "CT_2242282079588189025_846376335";

// Call OpenClaw webhook to generate report
webhook_url = "https://webhook.dmskills.org/webhooks/cliq";

payload = Map();
payload.put("handler", "menu");
payload.put("action", "timecard_report");
payload.put("channel_id", timecard_chat_id);
payload.put("channel_name", timecard_channel);
payload.put("user", user);
payload.put("chat", chat);

webhook_response = invokeUrl
[
    url: webhook_url
    type: POST
    parameters: payload.toString()
    headers: {"Content-Type": "application/json"}
];

// If webhook returns a report, display it
if(webhook_response != null && webhook_response.containsKey("text"))
{
    response.put("text", webhook_response.get("text"));
}
else
{
    // Fallback: Generate simple report using Cliq's built-in API
    messages = zoho.cliq.getMessages(timecard_chat_id, 50);
    
    today = zoho.currentdate;
    sign_ins = List();
    sign_outs = List();
    
    for each msg in messages
    {
        msg_time = msg.get("time").toDate();
        if(msg_time.getDay() == today.getDay())
        {
            text = msg.get("content").get("text").toLowerCase();
            sender = msg.get("sender").get("name");
            
            if(text.contains("sign") && text.contains("in"))
            {
                sign_ins.add(sender + " @ " + msg_time.toString("h:mm a"));
            }
            else if(text.contains("sign") && (text.contains("out") || text.contains("off")))
            {
                sign_outs.add(sender + " @ " + msg_time.toString("h:mm a"));
            }
        }
    }
    
    report = "📊 *Daily Timecard Report*\n";
    report = report + "📅 " + today.toString("EEEE, MMMM d, yyyy") + "\n\n";
    
    if(sign_ins.size() > 0)
    {
        report = report + "🟢 *Sign Ins:*\n";
        for each entry in sign_ins
        {
            report = report + "  • " + entry + "\n";
        }
        report = report + "\n";
    }
    
    if(sign_outs.size() > 0)
    {
        report = report + "🔴 *Sign Outs:*\n";
        for each entry in sign_outs
        {
            report = report + "  • " + entry + "\n";
        }
    }
    
    if(sign_ins.size() == 0 && sign_outs.size() == 0)
    {
        report = report + "_No sign-ins or sign-outs detected today._";
    }
    
    response.put("text", report);
}

return response;
*/
