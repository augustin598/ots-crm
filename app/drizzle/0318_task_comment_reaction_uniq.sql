CREATE UNIQUE INDEX task_comment_reaction_uniq ON task_comment_reaction (comment_id, user_id, emoji);
