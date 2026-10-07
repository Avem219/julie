// DEVELOPMENT SAMPLE DATA ONLY. Fictional people, fictional emails (@example.test), and a password you provide.
import type { DB } from './db.ts';
import { hashPassword } from './auth.ts';
import { newId } from './util.ts';

export function seedDev(db: DB, password: string, now = new Date()): Record<string, string> {
  if (password.length < 10) throw new Error('Seed password must be at least 10 characters');
  const t = now.toISOString(); const ids: Record<string, string> = {};
  const mk = (key: string, email: string, name: string, roles: string[]) => {
    const id = newId(); ids[key] = id;
    db.prepare('INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(id, email, name, hashPassword(password), t);
    for (const r of roles) db.prepare(`INSERT INTO user_roles(user_id,role,granted_at,reason) VALUES(?,?,?,'dev seed')`).run(id, r, t);
  };
  mk('student', 'student@example.test', 'Sam Student (sample)', ['STUDENT']);
  mk('teacher', 'teacher@example.test', 'Tara Teacher (sample)', ['TEACHER']);
  mk('teacher2', 'teacher2@example.test', 'Theo Teacher (sample)', ['TEACHER']);
  mk('admin', 'admin@example.test', 'Ada Admin (sample)', ['ADMIN']);
  mk('developer', 'developer@example.test', 'Dev Developer (sample)', ['DEVELOPER', 'STUDENT']);

  const course = (key: string, title: string, subject: string, premium: boolean, teacher: string, desc: string) => {
    const id = newId(); ids[key] = id;
    db.prepare(`INSERT INTO courses(id,slug,title,description,subject,level,status,is_premium,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?, 'PUBLISHED',?,?,?,?)`).run(id, key, title, `[Sample data] ${desc}`, subject, 'Beginner', premium ? 1 : 0, ids[teacher], t, t);
    db.prepare('INSERT INTO course_teachers(course_id,user_id) VALUES(?,?)').run(id, ids[teacher]);
    return id;
  };
  const lesson = (cid: string, pos: number, title: string, summary: string, content: string, preview = false) =>
    db.prepare(`INSERT INTO lessons(id,course_id,title,summary,content,position,xp_reward,is_preview,status,created_at) VALUES(?,?,?,?,?,?,10,?, 'PUBLISHED',?)`).run(newId(), cid, title, summary, content, pos, preview ? 1 : 0, t);
  const quiz = (cid: string, teacher: string, title: string, qs: { type: string; prompt: string; explanation: string; opts: [string, boolean][] }[]) => {
    const qid = newId();
    db.prepare(`INSERT INTO quizzes(id,course_id,title,description,passing_score_pct,status,created_by,created_at) VALUES(?,?,?,?,60,'PUBLISHED',?,?)`).run(qid, cid, title, '[Sample data]', ids[teacher], t);
    qs.forEach((q, i) => {
      const id = newId();
      db.prepare('INSERT INTO questions(id,quiz_id,type,prompt,explanation,points,position) VALUES(?,?,?,?,?,1,?)').run(id, qid, q.type, q.prompt, q.explanation, i);
      q.opts.forEach(([text, ok], j) => db.prepare('INSERT INTO options(id,question_id,text,is_correct,position) VALUES(?,?,?,?,?)').run(newId(), id, text, ok ? 1 : 0, j));
    });
  };

  const fr = course('fractions-basics', 'Fractions Basics', 'Mathematics', false, 'teacher', 'Understand and compare simple fractions.');
  lesson(fr, 1, 'What is a fraction?', 'Parts of a whole', 'A fraction describes equal parts of a whole.\n\nThe bottom number (denominator) says how many equal parts the whole is split into. The top number (numerator) says how many parts we are talking about.', true);
  lesson(fr, 2, 'Equivalent fractions', 'Same value, different look', 'Multiplying the numerator and denominator by the same non-zero number gives an equivalent fraction.\n\nFor example, 1/2 = 2/4 = 3/6.');
  quiz(fr, 'teacher', 'Fractions check-in', [
    { type: 'SINGLE_CHOICE', prompt: 'Which fraction is equivalent to 1/2?', explanation: 'Doubling top and bottom of 1/2 gives 2/4.', opts: [['2/4', true], ['2/3', false], ['1/3', false]] },
    { type: 'TRUE_FALSE', prompt: 'In 3/8, the number 8 is the denominator.', explanation: 'The denominator is the bottom number.', opts: [['True', true], ['False', false]] },
    { type: 'SHORT_ANSWER', prompt: 'What do we call the top number of a fraction?', explanation: 'The top number is the numerator.', opts: [['numerator', true]] },
  ]);
  const ph = course('photosynthesis-101', 'Photosynthesis 101 (premium)', 'Science', true, 'teacher2', 'How plants make food from light.');
  lesson(ph, 1, 'Light, water and carbon dioxide', 'The ingredients', 'Plants use light energy to turn carbon dioxide and water into glucose and oxygen.', true);
  lesson(ph, 2, 'Where it happens', 'Inside the chloroplast', 'Photosynthesis takes place in chloroplasts, which contain the green pigment chlorophyll.');
  quiz(ph, 'teacher2', 'Photosynthesis quiz', [
    { type: 'MULTIPLE_CHOICE', prompt: 'Which are inputs to photosynthesis?', explanation: 'Water and carbon dioxide are inputs; oxygen is an output.', opts: [['Water', true], ['Carbon dioxide', true], ['Oxygen', false]] },
  ]);
  db.prepare('INSERT INTO announcements(id,course_id,author_id,title,body,created_at) VALUES(?,?,?,?,?,?)').run(newId(), fr, ids.teacher, 'Welcome (sample)', '[Sample data] Welcome to the course.', t);

  for (const [name, desc] of [['Mathematics', 'Numbers, shapes and reasoning.'], ['Science', 'How the natural world works.']] as const)
    db.prepare('INSERT INTO subjects(id,slug,name,description,created_at) VALUES(?,?,?,?,?)').run(newId(), name.toLowerCase(), name, desc, t);
  const catId = newId();
  db.prepare('INSERT INTO news_categories(id,slug,name) VALUES(?,?,?)').run(catId, 'platform', 'Platform');
  db.prepare('INSERT INTO news_articles(id,category_id,author_id,slug,title,summary,body,status,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(newId(), catId, ids.admin, 'welcome-to-julie', 'Welcome to Julie (sample)', 'A quick look at what is new.', '[Sample data] Julie now includes goals, a study streak, and an AI tutor to help you learn.', 'PUBLISHED', t, t, t);
  db.prepare('INSERT INTO feature_flags(id,key,description,enabled,rollout_percent,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(newId(), 'new-dashboard-widgets', 'Show experimental dashboard widgets (sample flag)', 0, 0, ids.admin, t);
  return ids;
}
