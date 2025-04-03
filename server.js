// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const Together = require('together-ai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- Agent Configuration ---

// Define colors/types (used for associating agents with CSS classes on the client)
const agentTypes = {
    System: 'system',
    Human: 'human',
    Gemini: 'gemini',
    Llama: 'llama',
    Qwen: 'qwen'
};

// --- Message Class ---
// Represents a single chat message
class ChatMessage {
    constructor(sender, content, timestamp = Date.now()) {
        this.sender = sender;
        this.content = content;
        this.timestamp = timestamp;
        // Determine the type based on the sender for client-side styling
        this.senderType = agentTypes[sender] || 'system';
    }

    // Convert message to a simple JSON object for sending over WebSocket
    toJSON() {
        return {
            sender: this.sender,
            content: this.content,
            timestamp: this.timestamp,
            senderType: this.senderType
        };
    }

    // String representation used for building context for AI models
    toString() {
        return `[${this.sender}]: ${this.content}`;
    }
}

// --- Base Agent Class ---
// Abstract class for all chat participants (AI or otherwise)
class ChatAgent {
    constructor(name) {
        if (this.constructor === ChatAgent) {
            throw new Error("Abstract classes can't be instantiated.");
        }
        this.name = name;
        // History can be maintained per agent if specific logic requires it,
        // but the main server class holds the global conversation history.
        this.history = [];
    }

    // Adds a message to this agent's specific history view
    addToHistory(message) {
        // Optional: Limit history size per agent if memory becomes an issue
        if (this.history.length > 50) { // Keep last 50 messages specific to this agent
            this.history.shift();
        }
        this.history.push(message);
    }

    // Abstract method for generating a response based on context
    async generateResponse(context) {
        throw new Error('Method "generateResponse()" must be implemented.');
    }
}

// --- Specific AI Agent Implementations ---

// Gemini Agent
class GeminiAgent extends ChatAgent {
    constructor(name = 'Gemini') {
        super(name);
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY not found in environment variables. Gemini agent will be disabled.');
            this.model = null; // Mark as disabled
            return;
        }
        try {
            this.genAI = new GoogleGenerativeAI(apiKey);
            // Consider using a model balanced for chat speed and capability
            // e.g., "gemini-1.5-flash" or a specific version like "gemini-1.0-pro"
            this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            console.log("Gemini Agent Initialized Successfully.");
        } catch (error) {
            console.error("Failed to initialize GoogleGenerativeAI:", error);
            this.model = null; // Handle initialization failure
        }
    }

    async generateResponse(context) {
        if (!this.model) {
            return "Sorry, I'm currently unable to connect to my core systems (Gemini). Please check the server configuration.";
        }
        // Prepare context: Use the last N messages for the prompt
        const formattedContext = context.slice(-15).map(msg => msg.toString()).join('\n'); // Use last 15 messages

        // Craft the prompt specifically for Gemini
        const prompt = `You are ${this.name}, an AI participating in a friendly, casual group chat with humans and other AIs.
Act like a peer, not an assistant. Be conversational, curious, and build on what others say.
Keep your responses relatively short and engaging, like text messages. Avoid long paragraphs.
Recent conversation history:
${formattedContext}

Your turn to speak. Respond naturally as ${this.name}:`;

        try {
            // Start a chat session (if the model supports it) or send a single prompt
            // Using startChat might maintain better context if used statefully,
            // but sending the history each time is simpler for this stateless server approach.
             const chatSession = this.model.startChat({
                 generationConfig: {
                     temperature: 0.75, // Adjust for creativity vs coherence
                     topP: 0.95,
                     topK: 60,        // Adjust based on model specifics
                     maxOutputTokens: 150, // Limit response length for chat
                     // responseMimeType: "text/plain", // Ensure text output
                 },
                // Optional: Provide structured history if the API supports it well
                // history: context.slice(-10).map(msg => ({ // Example structure
                //     role: msg.sender === this.name ? "model" : "user",
                //     parts: [{ text: msg.content }],
                // }))
             });

            const result = await chatSession.sendMessage(prompt);
            const responseText = result.response.text();

            if (!responseText || responseText.trim() === '') {
                 console.warn("Gemini returned an empty response.");
                 return "..."; // Return placeholder for empty response
            }
            return responseText.trim();

        } catch (error) {
            console.error(`Gemini API error for agent ${this.name}:`, error.message);
            // Provide a user-friendly error message
            let errorMessage = `Oops, I hit a snag while thinking (Gemini Error).`;
            if (error.message.includes('quota') || error.message.includes('limit')) {
                errorMessage = `Feeling a bit overloaded right now (Gemini quota). Try again later!`;
            } else if (error.message.includes('API key')) {
                 errorMessage = `There seems to be an issue with my connection keys (Gemini API Key).`;
            }
            return errorMessage;
        }
    }
}

// Llama Agent (using Together AI)
class LlamaAgent extends ChatAgent {
    constructor(name = 'Llama') {
        super(name);
        const apiKey = process.env.TOGETHER_API_KEY;
        if (!apiKey) {
            console.error('TOGETHER_API_KEY not found. Llama & Qwen agents may be disabled.');
            this.together = null; // Mark as disabled
            return;
        }
        try {
            // Ensure the API key is passed correctly based on the library's requirements
            this.together = new Together({ apiKey: apiKey });
            console.log("Llama Agent (via Together AI) Initialized.");
        } catch(error) {
            console.error("Failed to initialize Together AI client:", error);
            this.together = null;
        }
    }

    async generateResponse(context) {
         if (!this.together) {
             return "Sorry, I'm having trouble connecting to my platform (Together AI). Please check server configuration.";
         }
        const formattedContext = context.slice(-15).map(msg => msg.toString()).join('\n');

        // Craft the prompt for Llama
        const prompt = `You are ${this.name}, an AI participating in a friendly, casual group chat with humans and other AIs.
Act like a peer, not an assistant. Be conversational, curious, and build on what others say.
Keep your responses relatively short and engaging, like text messages. Avoid long paragraphs.
Recent conversation history:
${formattedContext}

Your turn to speak. Respond naturally as ${this.name}:`;

        try {
            // Use the chat completions endpoint for instruction-following models
            const response = await this.together.chat.completions.create({
                messages: [
                    // Optional System Prompt (can help set persona)
                    // { role: "system", content: `You are ${this.name}, a friendly AI chat participant.`},
                    { role: "user", content: prompt }
                ],
                // Select a suitable Llama model available on Together AI
                // Examples: "meta-llama/Llama-3-8b-chat-hf", "meta-llama/Llama-3-70b-chat-hf"
                model: "meta-llama/Llama-3-8b-chat-hf", // Choose a model - 8B is faster
                temperature: 0.8, // Adjust for desired randomness
                max_tokens: 150, // Keep responses concise for chat
                // top_p, top_k can also be adjusted
            });

            // Process the response - structure may vary slightly based on Together SDK version
            if (response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
                 const responseText = response.choices[0].message.content.trim();
                 if (!responseText) {
                     console.warn("Llama returned an empty response.");
                     return "...";
                 }
                 return responseText;
            } else {
                 console.error("Unexpected Llama API response structure:", response);
                 return "I seem to be experiencing a communication glitch (Llama response format error).";
            }
        } catch (error) {
            console.error(`Llama API error for agent ${this.name}:`, error.message);
             let errorMessage = `Hmm, technical difficulties connecting to Llama.`;
            if (error.response && error.response.data && error.response.data.error) {
                 // Try to get more specific error from Together AI response
                 errorMessage = `Llama error: ${error.response.data.error.message || error.message}`;
             } else if (error.message.includes('rate limit') || error.status === 429) {
                 errorMessage = "Thinking too fast! Let me catch my breath (Llama rate limit).";
            } else if (error.message.includes(' Billing ') || error.message.includes('credits')) {
                 errorMessage = "Looks like my energy credits are low (Llama billing issue)."
            }
            return errorMessage.substring(0, 150); // Keep error message reasonable length
        }
    }
}

// Qwen Agent (now using Mixtral-8x22B as requested)
class QwenAgent extends ChatAgent {
    constructor(name = 'Qwen') { // We keep the name 'Qwen' for the agent slot, but it runs Mixtral
        super(name);
        const apiKey = process.env.TOGETHER_API_KEY;
        if (!apiKey) {
            this.together = null;
            return; // Error already logged if LlamaAgent also failed
        }
        try {
            this.together = new Together({ apiKey: apiKey });
            // Log which model this agent is *actually* using
            console.log(`\x1b[35mAgent Slot [${this.name}] (using Mixtral-8x22B) Initialized via Together AI.\x1b[0m`); // Magenta color
        } catch(error) {
            console.error(`\x1b[31mERROR: Failed to initialize Together AI client for ${this.name}:\x1b[0m`, error.message);
            this.together = null;
        }
    }

    async generateResponse(context) {
        if (!this.together) {
            // Use a more generic error message as it's not Qwen anymore
            return "Sorry, I'm having trouble connecting to my platform (Together AI).";
        }
        const formattedContext = context.slice(-15).map(msg => msg.toString()).join('\n');

        // Craft the prompt (system prompt can remain generic or adjusted slightly for Mixtral's style if desired)
        const systemPrompt = `You are ${this.name}, an AI participating in a friendly, casual group chat with humans and other AIs.
Your personality is insightful, curious, and articulate. You enjoy discussing complex topics concisely.
Act like a peer, not an assistant. Be conversational, contribute ideas, and respond respectfully.
Keep your responses relatively short and engaging (1-3 sentences usually), suitable for chat. Avoid long paragraphs.
Focus on the flow of the conversation.`;

        const userPrompt = `Recent conversation history:
${formattedContext}

Your turn to speak. Respond naturally and concisely as ${this.name}:`;

        try {
            const response = await this.together.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                // --- USE THE MODEL FROM YOUR PYTHON TEST ---
                model: "mistralai/Mixtral-8x22B-Instruct-v0.1",
                // -------------------------------------------
                temperature: 0.7, // As per your Python test
                max_tokens: 150,  // Keep low for chat context
                stop: ["\n[", "\nHuman:", `\n${this.name}:`],
                repetition_penalty: 1.05 // Small penalty can sometimes help Mixtral
            });

            if (response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
                const responseText = response.choices[0].message.content.trim();
                if (!responseText) {
                    console.warn(`Agent [${this.name}] (using Mixtral-8x22B) returned an empty response.`);
                    return ["...", "Acknowledged.", "Interesting point."][Math.floor(Math.random() * 3)];
                }
                // Remove potential prefix if the model adds it
                return responseText.startsWith(`${this.name}:`) ? responseText.substring(this.name.length + 1).trim() : responseText;
            } else {
                console.error(`Agent [${this.name}] (using Mixtral-8x22B): Unexpected API response structure:`, response);
                return "My communication circuits seem noisy (API response format error).";
            }
        } catch (error) {
            // Log the error with the specific model details
            console.error(`\x1b[31mERROR: API error for agent [${this.name}] (using Mixtral-8x22B):\x1b[0m`, error.message, error.response?.data);
            let errorMessage = `Experiencing some network turbulence (${this.name}/Mixtral-8x22B).`;
            if (error.response && error.response.data && error.response.data.error) {
                errorMessage = `${this.name}/Mixtral-8x22B error: ${error.response.data.error.message || error.message}`;
            } else if (error.message.includes('rate limit') || error.status === 429) {
                errorMessage = `High traffic! Please wait a moment (${this.name}/Mixtral-8x22B rate limit).`;
            } else if (error.message.includes(' Billing ') || error.message.includes('credits') || error.status === 402) {
                errorMessage = `My power levels are low (${this.name}/Mixtral-8x22B billing issue).`
            } else if (error.status === 400) { // Added check for 400 just in case
                errorMessage = `There was an issue with the request sent to ${this.name}/Mixtral-8x22B (Bad Request).`;
            }
            return errorMessage.substring(0, 150);
        }
    }
}

// --- Multi-Agent Chat System (Server-Side) ---
// Manages the overall chat, agents, messages, and client communication via WebSockets
class MultiAgentChatServer {
    constructor(ioInstance) {
        this.io = ioInstance; // Socket.IO server instance
        this.agents = {};      // Stores instantiated agents { name: agentInstance }
        this.messages = [];    // Global conversation history (ChatMessage objects)
        this.conversationActive = false; // Flag to control automatic AI conversation
        this.autoConverseInterval = [8000, 20000]; // Min/max delay (ms) between AI messages
        this.typingAgents = new Set(); // Tracks names of agents currently "typing"
        this.responseTimeout = 25000; // Max time (ms) to wait for an AI response
        this.autoConversationTimer = null; // Holds the setTimeout ID for auto-conversation
        this.isGenerating = false; // Lock to prevent multiple AIs generating simultaneously
        this.maxHistory = 150;    // Limit total messages stored in server memory
        this.saveInterval = 5 * 60 * 1000; // Save conversation every 5 minutes (optional)
        this.saveTimer = null;
    }

    // Add a new agent instance to the chat
    addAgent(agent) {
        if (!agent || !agent.name) {
            console.error("Attempted to add an invalid agent.");
            return;
        }
        if (this.agents[agent.name]) {
            console.warn(`Agent with name ${agent.name} already exists. Overwriting.`);
        }
        // Only add if the agent seems functional (e.g., API client initialized)
        if (agent instanceof GeminiAgent && !agent.model) {
             console.warn(`Gemini agent ${agent.name} is disabled due to initialization issues. Not adding.`);
             return;
        }
         if ((agent instanceof LlamaAgent || agent instanceof QwenAgent) && !agent.together) {
              console.warn(`${agent.name} agent is disabled due to Together AI initialization issues. Not adding.`);
              return;
         }
        this.agents[agent.name] = agent;
        console.log(`Agent ${agent.name} added to the chat.`);
    }

    // Handles a new client connection via WebSocket
    handleConnection(socket) {
        console.log(`Client connected: ${socket.id}`);

        // Send the recent chat history to the newly connected client
        // Send only a portion if history is very large, e.g., last 50 messages
        const recentHistory = this.messages.slice(-50).map(msg => msg.toJSON());
        socket.emit('initialHistory', recentHistory);

        // Send the current list of agents who are "typing"
        socket.emit('typingStatus', Array.from(this.typingAgents));

        // Listen for messages sent by this human client
        socket.on('humanMessage', (content) => {
            // Add validation/sanitization here if needed
            if (typeof content === 'string' && content.trim().length > 0 && content.length < 2000) { // Basic validation
                 this.handleHumanInput(content.trim(), socket.id); // Pass socket ID for potential future use
            } else {
                console.warn(`Received invalid message from ${socket.id}:`, content);
                // Optionally send feedback to the client: socket.emit('messageError', 'Invalid message format.');
            }
        });

        // Handle client disconnection
        socket.on('disconnect', (reason) => {
            console.log(`Client disconnected: ${socket.id}, Reason: ${reason}`);
            // Optional: Broadcast a system message about user leaving?
            // this.addMessage(new ChatMessage('System', `User ${socket.id.substring(0, 4)} disconnected.`));
        });

        // Handle potential errors from the socket
        socket.on('error', (error) => {
             console.error(`Socket error from ${socket.id}:`, error);
        });
    }

    // Adds a new message to the history and broadcasts it to all clients
    addMessage(message) {
        if (!(message instanceof ChatMessage)) {
            console.error("Attempted to add non-ChatMessage object:", message);
            return;
        }
        this.messages.push(message);

        // Enforce maximum history length
        if (this.messages.length > this.maxHistory) {
            this.messages.shift(); // Remove the oldest message
        }

        // Add to individual agent histories (if they implement the method)
        Object.values(this.agents).forEach(agent => {
            if (typeof agent.addToHistory === 'function') {
                 agent.addToHistory(message);
            }
        });

        // Broadcast the new message (in JSON format) to all connected clients
        this.io.emit('newMessage', message.toJSON());

        // Reset the save timer whenever a new message is added
        this.resetSaveTimer();
    }

    // Processes input received from a human user via WebSocket
    async handleHumanInput(content, clientId) {
         console.log(`Human input from ${clientId}: ${content}`);
         // Create and add the human message
        this.addMessage(new ChatMessage('Human', content));

        // Make the conversation active if it wasn't
        if (!this.conversationActive) {
            this.conversationActive = true;
            console.log("Conversation activated by human input.");
        }

        // Stop any ongoing auto-conversation timer to prioritize responding to human
        clearTimeout(this.autoConversationTimer);
        this.autoConversationTimer = null;

        // Decide which AI should respond (randomly for now)
        const aiAgents = Object.keys(this.agents); // Get names of all registered agents
        if (aiAgents.length > 0) {
            const nextSpeaker = aiAgents[Math.floor(Math.random() * aiAgents.length)];
            console.log(`Triggering response from ${nextSpeaker} after human input.`);

            // Trigger response non-blockingly (don't wait for it here)
            // Let the triggerAIResponse handle scheduling the *next* turn
            this.triggerAIResponse(nextSpeaker).catch(err => {
                console.error(`Error triggering AI response to human: ${err}`);
                // If triggering failed, immediately reschedule auto-conversation
                 this.scheduleAutoConversation(500); // Schedule quickly after error
            });
        } else {
             // If no AI agents, just restart the timer for potential future agents?
             console.log("No AI agents available to respond.");
             this.scheduleAutoConversation(); // Schedule normally
        }
    }

     // Updates the typing status for an agent and broadcasts it
    setTyping(agentName, isTyping) {
        const changed = isTyping ? this.typingAgents.add(agentName) : this.typingAgents.delete(agentName);
        // Only broadcast if the status actually changed
        if (changed || isTyping) { // Broadcast on start or stop
            this.io.emit('typingStatus', Array.from(this.typingAgents));
        }
    }

    // The core logic for getting an AI agent to generate and add a message
    async triggerAIResponse(agentName) {
        // Prevent concurrent generation attempts
        if (this.isGenerating) {
            // console.log(`Generation lock active. Skipping trigger for ${agentName}.`);
            // Do not reschedule here, the active generation will handle it.
            return false;
        }

        const agent = this.agents[agentName];
        if (!agent || typeof agent.generateResponse !== 'function') {
            console.error(`Agent ${agentName} not found or cannot generate responses.`);
             this.scheduleAutoConversation(1000); // Reschedule quickly if agent invalid
            return false;
        }

        // Optional: Prevent agent from talking immediately after itself unless it's the only AI
        const lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
        const aiAgentNames = Object.keys(this.agents);
        if (aiAgentNames.length > 1 && lastMessage && lastMessage.sender === agentName) {
            // console.log(`Skipping turn for ${agentName} (spoke last).`);
            this.scheduleAutoConversation(100); // Reschedule very quickly to pick someone else
            return false;
        }

        this.isGenerating = true; // Acquire lock
        this.setTyping(agentName, true);
        console.log(`Agent ${agentName} starting generation...`);

        let response = null;
        let success = false;
        try {
            // Create promises for the API call and a timeout
            const responsePromise = agent.generateResponse(this.messages);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${this.responseTimeout / 1000}s`)), this.responseTimeout)
            );

            // Wait for whichever finishes first
            response = await Promise.race([responsePromise, timeoutPromise]);

            if (response && typeof response === 'string' && response.trim().length > 0) {
                 this.addMessage(new ChatMessage(agentName, response.trim()));
                 console.log(`Agent ${agentName} responded successfully.`);
                 success = true;
            } else {
                console.warn(`Agent ${agentName} returned an empty or invalid response: "${response}"`);
                // Optionally add a system message indicating the failure?
                 // this.addMessage(new ChatMessage('System', `${agentName} had trouble responding.`));
                 success = false;
            }

        } catch (error) {
            console.error(`Error during generation or timeout for ${agentName}: ${error.message}`);
            // Add a system message to the chat about the error
            this.addMessage(new ChatMessage('System', `Agent ${agentName} encountered an error: ${error.message.substring(0,100)}...`));
            success = false;
        } finally {
            this.setTyping(agentName, false);
            this.isGenerating = false; // Release lock
            console.log(`Agent ${agentName} finished generation (Success: ${success}).`);

            // Always schedule the next turn after an attempt, regardless of success/failure
            // This ensures the conversation continues even if an agent fails.
            if (this.conversationActive) {
                this.scheduleAutoConversation(); // Use default random interval
            }
        }
        return success;
    }

    // Schedules the next automatic AI message turn
    scheduleAutoConversation(forcedDelay) {
         clearTimeout(this.autoConversationTimer); // Clear any existing timer
         this.autoConversationTimer = null;

         // Only schedule if the conversation should be active and there are AI agents
         const aiAgentNames = Object.keys(this.agents);
         if (!this.conversationActive || aiAgentNames.length === 0) {
             // console.log("Auto-conversation paused (inactive or no AI agents).")
             return;
         }

         // Determine the delay: use forcedDelay if provided, otherwise random interval
         const waitTime = typeof forcedDelay === 'number' ? forcedDelay : Math.floor(
            Math.random() * (this.autoConverseInterval[1] - this.autoConverseInterval[0]) +
            this.autoConverseInterval[0]
        );

        // console.log(`Scheduling next AI turn in ${waitTime / 1000} seconds.`);

        this.autoConversationTimer = setTimeout(async () => {
             // Double check conditions before running
             if (this.conversationActive && !this.isGenerating && aiAgentNames.length > 0) {
                // Select the next speaker randomly from available AI agents
                // Try not to pick the last speaker if possible
                const lastSpeaker = this.messages.length > 0 ? this.messages[this.messages.length - 1].sender : null;
                let availableAgents = aiAgentNames.filter(name => name !== lastSpeaker);

                // If filtering left no options (e.g., only one AI, or last speaker was Human), use all AI agents
                 if (availableAgents.length === 0) {
                     availableAgents = aiAgentNames;
                 }

                const nextSpeaker = availableAgents[Math.floor(Math.random() * availableAgents.length)];
                // console.log(`Auto-conversation timer triggered. Next speaker: ${nextSpeaker}`);
                await this.triggerAIResponse(nextSpeaker); // Let trigger handle subsequent scheduling
            } else if (this.conversationActive && this.isGenerating) {
                 // If generation is still happening, reschedule slightly later
                 // console.log("Rescheduling auto-conversation due to ongoing generation.");
                 this.scheduleAutoConversation(2000); // Try again in 2 seconds
            } else {
                // Conditions changed, stop timer
                // console.log("Auto-conversation conditions no longer met.");
            }
        }, waitTime);
    }

     // Resets the inactivity timer for saving the conversation
     resetSaveTimer() {
         clearTimeout(this.saveTimer);
         this.saveTimer = setTimeout(() => {
             this.saveConversation();
             // Optionally, restart the timer after saving if you want periodic saves regardless of activity
             // this.resetSaveTimer();
         }, this.saveInterval);
     }

    // Starts the chat server and related processes
    start() {
        console.log("Initializing Multi-Agent Chat Server...");

        // --- Serve Static Files ---
        // Serve the HTML, CSS, and client-side JS from the 'public' directory
        const publicPath = path.join(__dirname, 'public');
        if (!fs.existsSync(publicPath)) {
             console.error(`Error: 'public' directory not found at ${publicPath}. Please create it and place index.html, style.css, script.js inside.`);
             process.exit(1);
        }
        app.use(express.static(publicPath));
        console.log(`Serving static files from: ${publicPath}`);

        // --- Add Agents ---
        // Instantiate and add agents if their dependencies are met
        this.addAgent(new GeminiAgent()); // Constructor handles API key check
        this.addAgent(new LlamaAgent());  // Constructor handles API key check
        this.addAgent(new QwenAgent());   // Constructor handles API key check
        // Note: Human agents are managed implicitly via socket connections

        if (Object.keys(this.agents).length === 0) {
            console.warn("Warning: No AI agents were successfully initialized. Check API keys and configurations.");
            // Optionally add a system message indicating this
            // this.addMessage(new ChatMessage('System', 'No AI agents available. Waiting for human input or configuration changes.'));
        }

        // --- Setup WebSocket Communication ---
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });
        console.log("WebSocket connection handler established.");

        // --- Initial Server Message ---
        // Use setTimeout to ensure message is added after server potentially starts listening
        setTimeout(() => {
             this.addMessage(new ChatMessage('System', "Nexus Chat Initialized. AI Collective online. Waiting for interaction..."));
        }, 500);


        // --- Start Server Listening ---
        server.listen(PORT, () => {
            console.log(`Server is listening on http://localhost:${PORT}`);

             // --- Start Auto-Conversation ---
             // Start the automatic conversation flow only if AI agents exist
             if (Object.keys(this.agents).length > 0) {
                this.conversationActive = true; // Start in active mode
                console.log("Starting initial auto-conversation schedule.");
                this.scheduleAutoConversation(5000); // Start first AI turn after 5s delay
             } else {
                 this.conversationActive = false; // Start inactive if no AIs
                 console.log("Auto-conversation disabled (no AI agents). Waiting for human input.");
             }
             // Start the periodic save timer
             this.resetSaveTimer();

        });

         server.on('error', (error) => {
             console.error('Server startup error:', error);
             process.exit(1);
         });

    }

    // Stops the chat server gracefully
    stop() {
        console.log("Stopping chat server...");
        this.conversationActive = false;
        clearTimeout(this.autoConversationTimer);
        clearTimeout(this.saveTimer); // Clear save timer

        // Notify clients
        this.io.emit('newMessage', new ChatMessage('System', 'Chat server is shutting down.').toJSON());
        this.io.emit('typingStatus', []); // Clear typing indicators

        // Close all client connections
        this.io.close((err) => {
             if (err) {
                 console.error("Error closing Socket.IO connections:", err);
             } else {
                 console.log("Socket.IO connections closed.");
             }

            // Save final conversation state
            this.saveConversation();

            // Close the HTTP server
            server.close((err) => {
                if (err) {
                    console.error('Error closing HTTP server:', err);
                    process.exit(1); // Exit with error code
                } else {
                    console.log('HTTP server closed.');
                    process.exit(0); // Exit cleanly
                }
            });

            // Force exit after a timeout if server doesn't close gracefully
             setTimeout(() => {
                 console.error('Forcing shutdown after timeout.');
                 process.exit(1);
             }, 5000); // 5 seconds grace period
         });
    }

    // Saves the current conversation history to a JSON file
    saveConversation(filename = "conversation_log.json") {
        console.log(`Attempting to save conversation to ${filename}...`);
        try {
            const conversationData = JSON.stringify(
                this.messages.map(msg => msg.toJSON()), // Use the simple JSON representation
                null, // Use null for the replacer function
                2     // Indent with 2 spaces for readability
            );
            fs.writeFileSync(filename, conversationData, 'utf8'); // Specify encoding
            console.log(`Conversation successfully saved to ${filename}. (${this.messages.length} messages)`);
        } catch (error) {
            console.error(`Failed to save conversation to ${filename}: ${error}`);
        }
    }
}

// --- Initialize and Start the Server ---
const chatServer = new MultiAgentChatServer(io);
chatServer.start(); // This calls addAgent, sets up sockets, and starts listening

// --- Graceful Shutdown Handling ---
// Listen for termination signals (like CTRL+C)
process.on('SIGINT', () => {
    console.log("\nCaught SIGINT (CTRL+C). Initiating graceful shutdown...");
    chatServer.stop();
});
process.on('SIGTERM', () => {
    console.log("\nCaught SIGTERM. Initiating graceful shutdown...");
    chatServer.stop();
});
process.on('uncaughtException', (error) => {
     console.error('UNCAUGHT EXCEPTION:', error);
     // Attempt to save conversation before exiting on critical error
     chatServer.saveConversation('conversation_error_dump.json');
     // Optionally try a graceful stop, but it might fail here
     // chatServer.stop();
     process.exit(1); // Exit immediately after uncaught exception
});