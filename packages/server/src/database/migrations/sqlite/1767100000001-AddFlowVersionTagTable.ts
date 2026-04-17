import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm'

export class AddFlowVersionTagTable1767100000001 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('flow_version_tag')) return

        await queryRunner.createTable(
            new Table({
                name: 'flow_version_tag',
                columns: [
                    { name: 'id', type: 'varchar', isPrimary: true },
                    { name: 'entityType', type: 'varchar', length: '20' },
                    { name: 'entityId', type: 'varchar' },
                    { name: 'historyId', type: 'varchar' },
                    { name: 'tagName', type: 'varchar', length: '100' },
                    { name: 'description', type: 'text', isNullable: true },
                    { name: 'createdById', type: 'text' },
                    { name: 'createdByName', type: 'text' },
                    { name: 'createdDate', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
                    { name: 'workspaceId', type: 'text' }
                ]
            })
        )
        await queryRunner.createIndex(
            'flow_version_tag',
            new TableIndex({
                name: 'IDX_flow_version_tag_entity_tag',
                columnNames: ['entityType', 'entityId', 'tagName'],
                isUnique: true
            })
        )
        await queryRunner.createIndex(
            'flow_version_tag',
            new TableIndex({ name: 'IDX_flow_version_tag_history', columnNames: ['historyId'] })
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('flow_version_tag', true)
    }
}
