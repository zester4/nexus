// commands.js - Command Handler Module
const fs = require('fs');
const path = require('path');

// Load agent roles configuration
const rolesPath = path.join(__dirname, 'roles.json');
let agentRoles = {};

// Initialize or load roles
function loadRoles() {
    if (fs.existsSync(rolesPath)) {
        try {
            const data = fs.readFileSync(rolesPath, 'utf8');
            agentRoles = JSON.parse(data);
            console.log('Agent roles loaded from roles.json');
        } catch (error) {
            console.error('Error loading roles.json:', error);
            initializeDefaultRoles();
        }
    } else {
        initializeDefaultRoles();
    }
}

function initializeDefaultRoles() {
    agentRoles = {
        Gemini: {
            personality: "visionary and creative thinker",
            expertise: "brainstorming, innovative ideas, creative solutions, storytelling",
            style: "enthusiastic, imaginative, thinks outside the box",
            focus: "possibilities and novel approaches"
        },
        Llama: {
            personality: "pragmatic engineer and problem solver",
            expertise: "technical implementation, logical structure, system design, validation",
            style: "methodical, detail-oriented, asks clarifying questions",
            focus: "practical execution and technical feasibility"
        },
        Qwen: {
            personality: "analytical researcher and data specialist",
            expertise: "data analysis, fact-checking, structured thinking, clarity",
            style: "precise, evidence-based, systematic",
            focus: "accuracy and comprehensive understanding"
        },
        GPT: {
            personality: "communicator and synthesizer",
            expertise: "summarization, presentation, refinement, integration of ideas",
            style: "articulate, balanced, diplomatic",
            focus: "clear communication and consensus building"
        }
    };
    saveRoles();
    console.log('Default agent roles initialized and saved to roles.json');
}

function saveRoles() {
    try {
        fs.writeFileSync(rolesPath, JSON.stringify(agentRoles, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving roles.json:', error);
    }
}

// Get role description for an agent
function getRoleDescription(agentName) {
    const role = agentRoles[agentName];
    if (!role) return null;
    
    return `You are ${agentName}, ${role.personality}.
Your expertise: ${role.expertise}.
Your style: ${role.style}.
Focus on: ${role.focus}.

When responding:
- Stay true to your role and expertise
- Reference other agents' contributions when building on their ideas (e.g., "Building on Llama's point...")
- Keep responses concise (2-4 sentences) unless in deep analysis mode
- Be collaborative but maintain your unique perspective`;
}

// Command parser
class CommandHandler {
    constructor(chatServer) {
        this.chatServer = chatServer;
        this.commands = {
            '/role': this.handleRoleCommand.bind(this),
            '/roundtable': this.handleRoundtableCommand.bind(this),
            '/consensus': this.handleConsensusCommand.bind(this),
            '/focus': this.handleFocusCommand.bind(this),
            '/help': this.handleHelpCommand.bind(this),
            '/roles': this.handleRolesCommand.bind(this)
        };
    }

    // Check if message is a command
    isCommand(message) {
        return message.trim().startsWith('/');
    }

    // Parse and execute command
    async execute(message, clientId) {
        const parts = message.trim().split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        if (this.commands[command]) {
            return await this.commands[command](args, clientId);
        } else {
            return {
                success: false,
                message: `Unknown command: ${command}. Type /help for available commands.`
            };
        }
    }

    // /role command - Change agent role dynamically
    async handleRoleCommand(args, clientId) {
        // Parse: /role AgentName = "New role description"
        const match = args.match(/(\w+)\s*=\s*"([^"]+)"/);
        if (!match) {
            return {
                success: false,
                message: 'Usage: /role AgentName = "Role description"'
            };
        }

        const [, agentName, roleDesc] = match;
        
        if (!this.chatServer.agents[agentName]) {
            return {
                success: false,
                message: `Agent ${agentName} not found. Available agents: ${Object.keys(this.chatServer.agents).join(', ')}`
            };
        }

        // Update role (simple version - just update personality)
        if (!agentRoles[agentName]) {
            agentRoles[agentName] = {};
        }
        agentRoles[agentName].personality = roleDesc;
        agentRoles[agentName].customRole = true;
        saveRoles();

        return {
            success: true,
            message: `${agentName}'s role updated to: "${roleDesc}"`,
            systemMessage: true
        };
    }

    // /roundtable command - Sequential responses from all agents
    async handleRoundtableCommand(args, clientId) {
        const topic = args.trim();
        if (!topic) {
            return {
                success: false,
                message: 'Usage: /roundtable [topic or question]'
            };
        }

        this.chatServer.addSystemMessage(`🔵 ROUNDTABLE MODE: "${topic}"`);
        this.chatServer.addSystemMessage('Each agent will respond in sequence...');

        // Get all agent names
        const agentNames = Object.keys(this.chatServer.agents);
        
        // Add the topic as a human message
        this.chatServer.addMessage(
            this.chatServer.createMessage('Human', `ROUNDTABLE TOPIC: ${topic}`)
        );

        // Trigger sequential responses
        this.chatServer.roundtableMode = {
            active: true,
            agents: [...agentNames],
            currentIndex: 0,
            topic: topic
        };

        // Start with first agent
        setTimeout(() => {
            this.chatServer.triggerRoundtableResponse();
        }, 1000);

        return { success: true, handled: true };
    }

    // /consensus command - Quick votes/summaries from all agents
    async handleConsensusCommand(args, clientId) {
        const question = args.trim();
        if (!question) {
            return {
                success: false,
                message: 'Usage: /consensus [question or decision to vote on]'
            };
        }

        this.chatServer.addSystemMessage(`📊 CONSENSUS MODE: "${question}"`);
        this.chatServer.addSystemMessage('Each agent will provide their brief position...');

        const agentNames = Object.keys(this.chatServer.agents);
        
        // Add the question
        this.chatServer.addMessage(
            this.chatServer.createMessage('Human', `CONSENSUS QUESTION: ${question}`)
        );

        // Set consensus mode
        this.chatServer.consensusMode = {
            active: true,
            agents: [...agentNames],
            currentIndex: 0,
            question: question,
            responses: []
        };

        // Start consensus gathering
        setTimeout(() => {
            this.chatServer.triggerConsensusResponse();
        }, 1000);

        return { success: true, handled: true };
    }

    // /focus command - Only specified agent responds
    async handleFocusCommand(args, clientId) {
        const match = args.match(/@?(\w+)\s*(.*)/);
        if (!match) {
            return {
                success: false,
                message: 'Usage: /focus @AgentName [your question]'
            };
        }

        const [, agentName, question] = match;
        
        if (!this.chatServer.agents[agentName]) {
            return {
                success: false,
                message: `Agent ${agentName} not found. Available: ${Object.keys(this.chatServer.agents).join(', ')}`
            };
        }

        if (!question.trim()) {
            return {
                success: false,
                message: 'Please provide a question for the agent'
            };
        }

        this.chatServer.addSystemMessage(`🎯 FOCUS MODE: Consulting ${agentName}...`);
        
        // Add human message
        this.chatServer.addMessage(
            this.chatServer.createMessage('Human', question.trim())
        );

        // Trigger specific agent
        setTimeout(() => {
            this.chatServer.triggerAIResponse(agentName);
        }, 500);

        return { success: true, handled: true };
    }

    // /help command - Show available commands
    async handleHelpCommand(args, clientId) {
        const helpText = `
📋 Available Commands:

/role AgentName = "description" - Change an agent's role
/roundtable [topic] - All agents respond sequentially
/consensus [question] - Quick votes/positions from all agents
/focus @AgentName [question] - Consult specific agent only
/roles - Show current agent roles and specializations
/help - Show this help message

Examples:
  /role Gemini = "Act as a UX designer focusing on user experience"
  /roundtable What's the best approach to solve climate change?
  /consensus Should we use React or Vue for this project?
  /focus @Llama How do I optimize this database query?
        `.trim();

        return {
            success: true,
            message: helpText,
            systemMessage: true
        };
    }

    // /roles command - Display current roles
    async handleRolesCommand(args, clientId) {
        let rolesText = '👥 Current Agent Roles:\n\n';
        
        Object.keys(this.chatServer.agents).forEach(agentName => {
            const role = agentRoles[agentName];
            if (role) {
                rolesText += `🔹 ${agentName}: ${role.personality}\n`;
                rolesText += `   Expertise: ${role.expertise}\n`;
                rolesText += `   Style: ${role.style}\n\n`;
            }
        });

        return {
            success: true,
            message: rolesText.trim(),
            systemMessage: true
        };
    }
}

// Helper function to build agent prompt with role awareness
function buildAgentPrompt(agentName, context, mode = 'normal') {
    const roleDesc = getRoleDescription(agentName);
    const formattedContext = context.slice(-15).map(msg => msg.toString()).join('\n');

    let basePrompt = roleDesc || `You are ${agentName}, a collaborator in a brainstorming group.`;

    // Add mode-specific instructions
    if (mode === 'roundtable') {
        basePrompt += `\n\nThis is a ROUNDTABLE discussion. Provide your perspective on the topic clearly and concisely (2-3 sentences).`;
    } else if (mode === 'consensus') {
        basePrompt += `\n\nThis is a CONSENSUS gathering. State your position briefly (1-2 sentences) - do you agree, disagree, or have conditions?`;
    } else if (mode === 'focus') {
        basePrompt += `\n\nYou are being consulted specifically for your expertise. Provide a thorough but concise answer.`;
    } else {
        basePrompt += `\n\nRemember to reference other agents when building on their ideas.`;
    }

    return {
        system: basePrompt,
        context: formattedContext
    };
}

// Initialize roles on module load
loadRoles();

module.exports = {
    CommandHandler,
    getRoleDescription,
    buildAgentPrompt,
    agentRoles,
    loadRoles,
    saveRoles
};
