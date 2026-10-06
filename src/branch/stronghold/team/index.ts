/**
 * 要塞服 team 模块表层。
 *
 * 底层复用共享 Team 系统（孵化队列/派发/队伍状态机/战斗），
 * 本目录只放要塞服特有的表层（ATK 攻击旗解析、一体机小队配置）。
 */
import { TeamSpawner } from '@/modules/features/Team';
import './aio';    // 一体机小队配置注册（须在旗解析消费前完成）
import { atkSpecProvider } from './atk';

// 注册 ATK 旗型解析（须在 TeamSpawner.run 首次执行前完成——import 期即生效）
TeamSpawner.registerSpecProvider(atkSpecProvider);
