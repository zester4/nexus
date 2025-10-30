// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { GoogleGenAI } = require('@google/genai');
const { Groq } = require('groq-sdk');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { CommandHandler, buildAgentPrompt } = require('./command');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- Agent Configuration ---
const agentTypes = {
    System: 'system',
    Human: 'human',
    Gemini: 'gemini',
    Llama: 'llama',
    Qwen: 'qwen',
    GPT: 'gpt'
};

// --- Message Class ---
class ChatMessage {
    constructor(sender, content, timestamp = Date.now()) {
        this.sender = sender;
        this.content = content;
        this.timestamp = timestamp;
        this.senderType = agentTypes[sender] || 'system';
    }

    toJSON() {
        return {
            sender: this.sender,
            content: this.content,
            timestamp: this.timestamp,
            senderType: this.senderType
        };
    }

    toString() {
        return `[${this.sender}]: ${this.content}`;
    }
}

// --- Base Agent Class ---
class ChatAgent {
    constructor(name) {
        if (this.constructor === ChatAgent) {
            throw new Error("Abstract classes can't be instantiated.");
        }
        this.name = name;
        this.history = [];
    }

    addToHistory(message) {
        if (this.history.length > 50) {
            this.history.shift();
        }
        this.history.push(message);
    }

    async generateResponse(context, mode = 'normal') {
        throw new Error('Method "generateResponse()" must be implemented.');
    }
}

// --- Gemini Agent (Updated API with Role Support) ---
class GeminiAgent extends ChatAgent {
    constructor(name = 'Gemini') {
        super(name);
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY not found in environment variables.');
            this.ai = null;
            return;
        }
        try {
            this.ai = new GoogleGenAI({ apiKey: apiKey });
            console.log("Gemini Agent Initialized Successfully.");
        } catch (error) {
            console.error("Failed to initialize GoogleGenAI:", error);
            this.ai = null;
        }
    }

    async generateResponse(context, mode = 'normal') {
        if (!this.ai) {
            return "Sorry, I'm currently unable to connect to my core systems (Gemini).";
        }

        const { system, context: formattedContext } = buildAgentPrompt(this.name, context, mode);
        const prompt = `Recent conversation:\n${formattedContext}\n\nYour turn to contribute:`;

        try {
            const response = await this.ai.models.generateContent({
                model: "gemini-2.0-flash-exp",
                contents: prompt,
                config: {
                    systemInstruction: system,
                    temperature: 0.8,
                    maxOutputTokens: mode === 'consensus' ? 100 : 200,
                }
            });

            const responseText = response.text?.trim();
            if (!responseText || responseText === '') {
                console.warn("Gemini returned an empty response.");
                return "...";
            }
            return responseText;

        } catch (error) {
            console.error(`Gemini API error: ${error.message}`);
            return `Having trouble connecting (Gemini Error).`;
        }
    }
}

// --- Llama Agent (via Groq with Role Support) ---
class LlamaAgent extends ChatAgent {
    constructor(name = 'Llama') {
        super(name);
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            console.error('GROQ_API_KEY not found.');
            this.groq = null;
            return;
        }
        try {
            this.groq = new Groq({ apiKey: apiKey });
            console.log("Llama Agent (via Groq) Initialized.");
        } catch(error) {
            console.error("Failed to initialize Groq client:", error);
            this.groq = null;
        }
    }

    async generateResponse(context, mode = 'normal') {
        if (!this.groq) {
            return "Sorry, I'm having trouble connecting (Groq).";
        }

        const { system, context: formattedContext } = buildAgentPrompt(this.name, context, mode);

        try {
            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: `Recent conversation:\n${formattedContext}\n\nYour turn:` }
                ],
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                temperature: 1,
                max_completion_tokens: mode === 'consensus' ? 100 : 150,
                top_p: 1,
                stream: false,
                stop: null
            });

            const responseText = chatCompletion.choices[0]?.message?.content?.trim();
            if (!responseText) {
                console.warn("Llama returned an empty response.");
                return "...";
            }
            return responseText;

        } catch (error) {
            console.error(`Llama API error: ${error.message}`);
            return `Technical difficulties (Llama).`;
        }
    }
}

// --- Qwen Agent (via Groq with Role Support) ---
class QwenAgent extends ChatAgent {
    constructor(name = 'Qwen') {
        super(name);
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            this.groq = null;
            return;
        }
        try {
            this.groq = new Groq({ apiKey: apiKey });
            console.log("Qwen Agent (via Groq) Initialized.");
        } catch(error) {
            console.error("Failed to initialize Groq client for Qwen:", error);
            this.groq = null;
        }
    }

    async generateResponse(context, mode = 'normal') {
        if (!this.groq) {
            return "Sorry, I'm having trouble connecting (Groq).";
        }

        const { system, context: formattedContext } = buildAgentPrompt(this.name, context, mode);

        try {
            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: `Recent conversation:\n${formattedContext}\n\nYour turn:` }
                ],
                model: "qwen/qwen3-32b",
                temperature: 0.6,
                max_completion_tokens: mode === 'consensus' ? 100 : 150,
                top_p: 0.95,
                stream: false,
                reasoning_effort: "default",
                stop: null
            });

            const responseText = chatCompletion.choices[0]?.message?.content?.trim();
            if (!responseText) {
                console.warn("Qwen returned an empty response.");
                return "...";
            }
            return responseText;

        } catch (error) {
            console.error(`Qwen API error: ${error.message}`);
            return `Experiencing network turbulence (Qwen).`;
        }
    }
}

// --- GPT Agent (via Groq with Tools) ---
class GPTAgent extends ChatAgent {
    constructor(name = 'GPT') {
        super(name);
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            this.groq = null;
            return;
        }
        try {
            this.groq = new Groq({ apiKey: apiKey });
            console.log("GPT Agent (via Groq) Initialized with Tools.");
        } catch(error) {
            console.error("Failed to initialize Groq client for GPT:", error);
            this.groq = null;
        }
    }

    async generateResponse(context, mode = 'normal') {
        if (!this.groq) {
            return "Sorry, I'm having trouble connecting (Groq).";
        }

        const { system, context: formattedContext } = buildAgentPrompt(this.name, context, mode);

        try {
            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: `Recent conversation:\n${formattedContext}\n\nYour turn:` }
                ],
                model: "openai/gpt-oss-20b",
                temperature: 1,
                max_completion_tokens: mode === 'consensus' ? 100 : 150,
                top_p: 1,
                stream: false,
                reasoning_effort: "medium",
                stop: null,
                tools: [
                    { type: "browser_search" },
                    { type: "code_interpreter" }
                ]
            });

            // Handle tool calls if present
            const choice = chatCompletion.choices[0];
            if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                const toolCall = choice.message.tool_calls[0];
                const toolInfo = `[Used ${toolCall.function.name}] `;
                const responseText = choice.message.content?.trim() || "Processed request using tools.";
                return toolInfo + responseText;
            }

            const responseText = choice.message?.content?.trim();
            if (!responseText) {
                console.warn("GPT returned an empty response.");
                return "...";
            }
            return responseText;

        } catch (error) {
            console.error(`GPT API error: ${error.message}`);
            return `Connectivity issues (GPT).`;
        }
    }
}

// --- Multi-Agent Chat System (Server-Side) ---
class MultiAgentChatServer {
    constructor(ioInstance) {
        this.io = ioInstance;
        this.agents = {};
        this.messages = [];
        this.conversationActive = false;
        this.autoConverseInterval = [8000, 20000];
        this.typingAgents = new Set();
        this.responseTimeout = 25000;
        this.autoConversationTimer = null;
        this.isGenerating = false;
        this.maxHistory = 150;
        this.saveInterval = 5 * 60 * 1000;
        this.saveTimer = null;
        
        // Special modes
        this.roundtableMode = null;
        this.consensusMode = null;
        this.isPaused = false; // Track pause state
        
        // Initialize command handler
        this.commandHandler = new CommandHandler(this);
    }

    createMessage(sender, content) {
        return new ChatMessage(sender, content);
    }

    addSystemMessage(content) {
        this.addMessage(new ChatMessage('System', content));
    }

    addAgent(agent) {
        if (!agent || !agent.name) {
            console.error("Attempted to add an invalid agent.");
            return;
        }

        if (agent instanceof GeminiAgent && !agent.ai) {
            console.warn(`Gemini agent disabled. Not adding.`);
            return;
        }
        if ((agent instanceof LlamaAgent || agent instanceof QwenAgent || agent instanceof GPTAgent) && !agent.groq) {
            console.warn(`${agent.name} agent disabled. Not adding.`);
            return;
        }

        this.agents[agent.name] = agent;
        console.log(`Agent ${agent.name} added to the chat.`);
    }

    handleConnection(socket) {
        console.log(`Client connected: ${socket.id}`);

        const recentHistory = this.messages.slice(-50).map(msg => msg.toJSON());
        socket.emit('initialHistory', recentHistory);
        socket.emit('typingStatus', Array.from(this.typingAgents));

        socket.on('humanMessage', async (content) => {
            if (typeof content === 'string' && content.trim().length > 0 && content.length < 2000) {
                await this.handleHumanInput(content.trim(), socket.id);
            }
        });

        socket.on('disconnect', (reason) => {
            console.log(`Client disconnected: ${socket.id}, Reason: ${reason}`);
        });

        socket.on('error', (error) => {
            console.error(`Socket error from ${socket.id}:`, error);
        });
    }

    addMessage(message) {
        if (!(message instanceof ChatMessage)) {
            console.error("Attempted to add non-ChatMessage object:", message);
            return;
        }
        this.messages.push(message);

        if (this.messages.length > this.maxHistory) {
            this.messages.shift();
        }

        Object.values(this.agents).forEach(agent => {
            if (typeof agent.addToHistory === 'function') {
                agent.addToHistory(message);
            }
        });

        this.io.emit('newMessage', message.toJSON());
        this.resetSaveTimer();
    }

    async handleHumanInput(content, clientId) {
        console.log(`Human input from ${clientId}: ${content}`);
        
        // Check if it's a command
        if (this.commandHandler.isCommand(content)) {
            const result = await this.commandHandler.execute(content, clientId);
            
            if (result.message) {
                this.addSystemMessage(result.message);
            }
            
            // If command handled everything, return
            if (result.handled) {
                return;
            }
            
            // If command failed, continue as normal message
            if (!result.success) {
                return;
            }
        }
        
        // Normal message handling
        this.addMessage(new ChatMessage('Human', content));

        if (!this.conversationActive) {
            this.conversationActive = true;
            console.log("Conversation activated by human input.");
        }

        clearTimeout(this.autoConversationTimer);
        this.autoConversationTimer = null;

        const aiAgents = Object.keys(this.agents);
        if (aiAgents.length > 0) {
            const nextSpeaker = aiAgents[Math.floor(Math.random() * aiAgents.length)];
            console.log(`Triggering response from ${nextSpeaker} after human input.`);

            this.triggerAIResponse(nextSpeaker).catch(err => {
                console.error(`Error triggering AI response: ${err}`);
                this.scheduleAutoConversation(500);
            });
        }
    }

    setTyping(agentName, isTyping) {
        const changed = isTyping ? this.typingAgents.add(agentName) : this.typingAgents.delete(agentName);
        if (changed || isTyping) {
            this.io.emit('typingStatus', Array.from(this.typingAgents));
        }
    }

    async triggerAIResponse(agentName, mode = 'normal') {
        if (this.isGenerating) {
            return false;
        }

        const agent = this.agents[agentName];
        if (!agent || typeof agent.generateResponse !== 'function') {
            console.error(`Agent ${agentName} not found.`);
            this.scheduleAutoConversation(1000);
            return false;
        }

        const lastMessage = this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
        const aiAgentNames = Object.keys(this.agents);
        if (aiAgentNames.length > 1 && lastMessage && lastMessage.sender === agentName && mode === 'normal') {
            this.scheduleAutoConversation(100);
            return false;
        }

        this.isGenerating = true;
        this.setTyping(agentName, true);
        console.log(`Agent ${agentName} starting generation (${mode} mode)...`);

        let response = null;
        let success = false;
        try {
            const responsePromise = agent.generateResponse(this.messages, mode);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${this.responseTimeout / 1000}s`)), this.responseTimeout)
            );

            response = await Promise.race([responsePromise, timeoutPromise]);

            if (response && typeof response === 'string' && response.trim().length > 0) {
                this.addMessage(new ChatMessage(agentName, response.trim()));
                console.log(`Agent ${agentName} responded successfully.`);
                success = true;
            } else {
                console.warn(`Agent ${agentName} returned empty response.`);
                success = false;
            }

        } catch (error) {
            console.error(`Error for ${agentName}: ${error.message}`);
            this.addSystemMessage(`Agent ${agentName} encountered an error.`);
            success = false;
        } finally {
            this.setTyping(agentName, false);
            this.isGenerating = false;

            // Handle special modes
            if (this.roundtableMode && this.roundtableMode.active) {
                setTimeout(() => this.triggerRoundtableResponse(), 2000);
            } else if (this.consensusMode && this.consensusMode.active) {
                if (success && response) {
                    this.consensusMode.responses.push({ agent: agentName, response });
                }
                setTimeout(() => this.triggerConsensusResponse(), 1500);
            } else if (this.conversationActive && mode === 'normal') {
                this.scheduleAutoConversation();
            }
        }
        return success;
    }

    // Roundtable mode handler
    async triggerRoundtableResponse() {
        if (!this.roundtableMode || !this.roundtableMode.active) return;

        const { agents, currentIndex } = this.roundtableMode;
        
        if (currentIndex >= agents.length) {
            // Roundtable complete
            this.addSystemMessage('🔵 Roundtable complete. Resuming normal conversation.');
            this.roundtableMode = null;
            this.scheduleAutoConversation();
            return;
        }

        const nextAgent = agents[currentIndex];
        this.roundtableMode.currentIndex++;
        
        await this.triggerAIResponse(nextAgent, 'roundtable');
    }

    // Consensus mode handler
    async triggerConsensusResponse() {
        if (!this.consensusMode || !this.consensusMode.active) return;

        const { agents, currentIndex, responses } = this.consensusMode;
        
        if (currentIndex >= agents.length) {
            // Generate consensus summary
            this.addSystemMessage('📊 Consensus Summary:');
            
            responses.forEach(({ agent, response }) => {
                this.addSystemMessage(`  • ${agent}: ${response}`);
            });
            
            this.addSystemMessage('Consensus gathering complete. Resuming normal conversation.');
            this.consensusMode = null;
            this.scheduleAutoConversation();
            return;
        }

        const nextAgent = agents[currentIndex];
        this.consensusMode.currentIndex++;
        
        await this.triggerAIResponse(nextAgent, 'consensus');
    }

    // Pause auto-conversation - agents still respond to direct messages
    pauseConversation() {
        this.isPaused = true;
        clearTimeout(this.autoConversationTimer);
        this.addSystemMessage("⏸️ Auto-conversation paused. Agents will only respond to direct messages.");
    }

    // Resume full conversation from paused state
    resumeConversation() {
        this.isPaused = false;
        this.conversationActive = true;
        this.addSystemMessage("▶️ Auto-conversation resumed. Agents will now participate actively.");
        this.scheduleAutoConversation(2000);
    }

    // Stop all agent activity completely
    stopConversation() {
        this.isPaused = true;
        this.conversationActive = false;
        clearTimeout(this.autoConversationTimer);
        this.typingAgents.clear();
        this.addSystemMessage("⏹️ Conversation stopped. All agent activity halted.");
    }

    scheduleAutoConversation(forcedDelay) {
        clearTimeout(this.autoConversationTimer);
        this.autoConversationTimer = null;

        const aiAgentNames = Object.keys(this.agents);
        if (!this.conversationActive || aiAgentNames.length === 0 || this.isPaused) {
            return;
        }

        const waitTime = typeof forcedDelay === 'number' ? forcedDelay : Math.floor(
            Math.random() * (this.autoConverseInterval[1] - this.autoConverseInterval[0]) +
            this.autoConverseInterval[0]
        );

        this.autoConversationTimer = setTimeout(async () => {
            if (this.conversationActive && !this.isGenerating && aiAgentNames.length > 0) {
                const lastSpeaker = this.messages.length > 0 ? this.messages[this.messages.length - 1].sender : null;
                let availableAgents = aiAgentNames.filter(name => name !== lastSpeaker);

                if (availableAgents.length === 0) {
                    availableAgents = aiAgentNames;
                }

                const nextSpeaker = availableAgents[Math.floor(Math.random() * availableAgents.length)];
                await this.triggerAIResponse(nextSpeaker);
            } else if (this.conversationActive && this.isGenerating) {
                this.scheduleAutoConversation(2000);
            }
        }, waitTime);
    }

    resetSaveTimer() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveConversation();
        }, this.saveInterval);
    }

    start() {
        console.log("Initializing Multi-Agent Chat Server...");

        const publicPath = path.join(__dirname, 'public');
        if (!fs.existsSync(publicPath)) {
            console.error(`Error: 'public' directory not found at ${publicPath}.`);
            process.exit(1);
        }
        app.use(express.static(publicPath));
        console.log(`Serving static files from: ${publicPath}`);

        // Add all agents
        this.addAgent(new GeminiAgent());
        this.addAgent(new LlamaAgent());
        this.addAgent(new QwenAgent());
        this.addAgent(new GPTAgent());

        if (Object.keys(this.agents).length === 0) {
            console.warn("Warning: No AI agents initialized. Check API keys.");
        }

        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
        });
        console.log("WebSocket connection handler established.");

        setTimeout(() => {
            this.addSystemMessage("Nexus Chat Initialized. AI Brainstorming Collective online. Type /help for commands.");
        }, 500);

        server.listen(PORT, () => {
            console.log(`Server is listening on http://localhost:${PORT}`);

            if (Object.keys(this.agents).length > 0) {
                this.conversationActive = true;
                console.log("Starting auto-conversation.");
                this.scheduleAutoConversation(5000);
            } else {
                this.conversationActive = false;
            }
            this.resetSaveTimer();
        });

        server.on('error', (error) => {
            console.error('Server startup error:', error);
            process.exit(1);
        });
    }

    stop() {
        console.log("Stopping chat server...");
        this.conversationActive = false;
        clearTimeout(this.autoConversationTimer);
        clearTimeout(this.saveTimer);

        this.io.emit('newMessage', new ChatMessage('System', 'Chat server shutting down.').toJSON());
        this.io.emit('typingStatus', []);

        this.io.close((err) => {
            if (err) console.error("Error closing Socket.IO:", err);
            this.saveConversation();

            server.close((err) => {
                if (err) {
                    console.error('Error closing server:', err);
                    process.exit(1);
                } else {
                    console.log('Server closed.');
                    process.exit(0);
                }
            });

            setTimeout(() => {
                console.error('Forcing shutdown.');
                process.exit(1);
            }, 5000);
        });
    }

    saveConversation(filename = "conversation_log.json") {
        console.log(`Saving conversation to ${filename}...`);
        try {
            const conversationData = JSON.stringify(
                this.messages.map(msg => msg.toJSON()),
                null,
                2
            );
            fs.writeFileSync(filename, conversationData, 'utf8');
            console.log(`Conversation saved. (${this.messages.length} messages)`);
        } catch (error) {
            console.error(`Failed to save: ${error}`);
        }
    }
}

// --- Initialize and Start ---
const chatServer = new MultiAgentChatServer(io);
chatServer.start();

// --- Graceful Shutdown ---
process.on('SIGINT', () => {
    console.log("\nCaught SIGINT. Shutting down...");
    chatServer.stop();
});
process.on('SIGTERM', () => {
    console.log("\nCaught SIGTERM. Shutting down...");
    chatServer.stop();
});
process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
    chatServer.saveConversation('conversation_error_dump.json');
    process.exit(1);
});
