// 提交代码到游戏
import shelljs from 'shelljs';
import { select, confirm } from '@inquirer/prompts';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const userConfigPath = path.resolve(__dirname, '../.secret.json');
let userConfig;
if (fs.existsSync(userConfigPath)) {
    userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
} else {
    console.error('配置文件未找到:', userConfigPath);
    process.exit(1);
}


const allUsers = Object.keys(userConfig);

const selectUser = async () => {
	try {
		return await select({
			message: '提交至',
			choices: allUsers.map((name) => {
				return {
					name,
					value: name
				};
			})
		});
	} catch (error) {
		return '';
	}
};

const exec = (user) => {
	shelljs.exec(`npx rollup -cw --environment DEST:${user}`);
};

const submit = async () => {
	let user = process.argv[2];

	if (userConfig[user]) {
		exec(user);
		return;
	}

	user = allUsers.find((name) => name.includes(user));
	if (user) {
		if (await confirm({ message: `确定提交到 ${user} 吗？` })) {
			exec(user);
			return;
		}
	}

	user = await selectUser();
	if (user) {
		exec(user);
	}
};

submit();
