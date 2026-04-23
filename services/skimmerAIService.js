const Groq = require('groq-sdk');
const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

/**
 * AI Service for Skimmer Co-Pilot
 * Handles high-level planning (70B) and contextual advice (8B).
 */

const FALLBACK_PLAN = {
    roles: [
        {
            role: "Project Lead",
            tasks: [
                { title: "Initial Setup", description: "Establish project environment and communication channels.", days: 2, weight: 1 },
                { title: "Requirements Finalization", description: "Detailed review of project specifications.", days: 3, weight: 2 }
            ]
        }
    ]
};

const FALLBACK_ADVICE = {
    summary: "System is analyzing your project.",
    client_action: "Ensure requirements are clearly communicated to the team.",
    freelancer_action: "Update work logs regularly to ensure accurate health tracking."
};

/**
 * Generates a versioned project plan using Llama 3 70B
 */
const generateProjectPlan = async (job) => {
    try {
        const prompt = `
        You are a Senior Project Architect. 
        Break this project into roles, tasks, and estimated timelines. 
        Assign weights (1-5) based on task importance.
        
        Project Title: ${job.title}
        Project Description: ${job.description}
        Required Skills: ${job.skills ? job.skills.join(', ') : 'N/A'}
        
        Return ONLY valid JSON:
        {
          "roles": [
            {
              "role": "e.g. Lead Developer",
              "tasks": [
                { "title": "...", "description": "...", "days": 3, "weight": 2 }
              ]
            }
          ]
        }
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: 'json_object' }
        });

        let plan;
        try {
            plan = JSON.parse(completion.choices[0].message.content);
        } catch (e) {
            logger.error('[SkimmerAI] JSON Parse failed, using fallback', e);
            plan = FALLBACK_PLAN;
        }

        // Handle Versioning
        // 1. Get current version
        const { data: latestTask } = await adminClient
            .from('project_tasks')
            .select('version')
            .eq('job_id', job.id)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();

        const newVersion = (latestTask?.version || 0) + 1;

        // 2. Deactivate old tasks
        await adminClient
            .from('project_tasks')
            .update({ is_active: false })
            .eq('job_id', job.id);

        // 3. Insert new tasks
        const tasksToInsert = [];
        plan.roles.forEach(roleObj => {
            roleObj.tasks.forEach(task => {
                tasksToInsert.push({
                    job_id: job.id,
                    role: roleObj.role,
                    title: task.title,
                    description: task.description,
                    expected_days: task.days,
                    weight: task.weight || 1,
                    version: newVersion,
                    is_active: true,
                    status: 'pending'
                });
            });
        });

        const { error } = await adminClient.from('project_tasks').insert(tasksToInsert);
        if (error) throw error;

        return { success: true, version: newVersion, plan };

    } catch (err) {
        logger.error('[SkimmerAI] generateProjectPlan failed', err);
        return { success: false, plan: FALLBACK_PLAN };
    }
};

/**
 * Generates contextual advice using Llama 3 8B (Cost Optimized)
 */
const generateProjectAdvice = async (jobId, metrics) => {
    try {
        // Fetch last 5 activities for context
        const { data: recentLogs } = await adminClient
            .from('project_activity_log')
            .select('type, priority, created_at')
            .eq('job_id', jobId)
            .order('created_at', { ascending: false })
            .limit(5);

        const context = {
            health_score: metrics.health_score,
            delay_risk: metrics.delay_risk,
            efficiency: metrics.team_efficiency,
            recent_activities: recentLogs || []
        };

        const prompt = `
        You are a Staff Project Manager AI. 
        Analyze these metrics and recent activities to provide actionable advice.
        
        Metrics: ${JSON.stringify(context)}
        
        Return ONLY valid JSON:
        {
          "summary": "High-level status",
          "client_action": "Actionable step for client",
          "freelancer_action": "Actionable step for freelancers"
        }
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: 'json_object' }
        });

        try {
            return JSON.parse(completion.choices[0].message.content);
        } catch (e) {
            return FALLBACK_ADVICE;
        }

    } catch (err) {
        logger.error('[SkimmerAI] generateProjectAdvice failed', err);
        return FALLBACK_ADVICE;
    }
};

module.exports = {
    generateProjectPlan,
    generateProjectAdvice
};
