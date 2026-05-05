/* eslint-disable */
import { Entity, Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Index } from 'typeorm'
import { ChatflowType, IChatFlow } from '../../Interface'

export enum EnumChatflowType {
    CHATFLOW = 'CHATFLOW',
    AGENTFLOW = 'AGENTFLOW',
    MULTIAGENT = 'MULTIAGENT',
    ASSISTANT = 'ASSISTANT'
}

@Entity()
@Index('idx_chat_flow_name_workspace', ['name', 'workspaceId'], { unique: true })
export class ChatFlow implements IChatFlow {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column()
    name: string

    @Column({ type: 'text' })
    flowData: string

    // 'deployed' is reused as the runtime active/inactive toggle.
    // When false, the prediction controller rejects requests with 403.
    // (UI labels this "Active/Inactive" — name retained to avoid breaking migrations.)
    @Column({ nullable: true })
    deployed?: boolean

    @Column({ nullable: true })
    isPublic?: boolean

    @Column({ nullable: true })
    apikeyid?: string

    @Column({ nullable: true, type: 'text' })
    chatbotConfig?: string

    @Column({ nullable: true, type: 'text' })
    apiConfig?: string

    @Column({ nullable: true, type: 'text' })
    analytic?: string

    @Column({ nullable: true, type: 'text' })
    speechToText?: string

    @Column({ nullable: true, type: 'text' })
    textToSpeech?: string

    @Column({ nullable: true, type: 'text' })
    followUpPrompts?: string

    @Column({ nullable: true, type: 'text' })
    category?: string

    @Column({ type: 'varchar', length: 20, default: EnumChatflowType.CHATFLOW })
    type?: ChatflowType

    @Column({ type: 'timestamp' })
    @CreateDateColumn()
    createdDate: Date

    @Column({ type: 'timestamp' })
    @UpdateDateColumn()
    updatedDate: Date

    @Column({ nullable: true, type: 'text' })
    mcpServerConfig?: string

    @Column({ nullable: false, type: 'text' })
    workspaceId: string

    @Column({ nullable: true, type: 'int' })
    currentHistoryVersion?: number

    @Column({ nullable: true, type: 'int' })
    publishedVersion?: number
}
