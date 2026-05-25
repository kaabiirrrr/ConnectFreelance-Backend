const adminClient = require('./supabase/adminClient');

async function fix() {
    const sql = `
CREATE OR REPLACE FUNCTION public.update_profile_rating()
RETURNS TRIGGER AS $$
DECLARE
    new_avg NUMERIC(3,2);
BEGIN
    -- Calculate new average for the reviewee
    SELECT COALESCE(AVG(rating), 0)::NUMERIC(3,2)
    INTO new_avg
    FROM public.reviews
    WHERE reviewee_id = COALESCE(NEW.reviewee_id, OLD.reviewee_id);

    -- Update the profiles table using user_id instead of id
    UPDATE public.profiles
    SET rating = new_avg
    WHERE user_id = COALESCE(NEW.reviewee_id, OLD.reviewee_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
    `;

    console.log('Attempting to apply fix via rpc("exec_sql")...');
    const { error } = await adminClient.rpc('exec_sql', { sql_query: sql }); // wait, is the parameter name sql_query or sql? Let's check both

    if (error) {
        console.log('rpc("exec_sql") failed, trying parameter name "sql"...');
        const { error: error2 } = await adminClient.rpc('exec_sql', { sql });
        if (error2) {
            console.error('Failed to apply fix:', error2);
        } else {
            console.log('Fix applied successfully with parameter "sql"!');
        }
    } else {
        console.log('Fix applied successfully with parameter "sql_query"!');
    }
}

fix();
